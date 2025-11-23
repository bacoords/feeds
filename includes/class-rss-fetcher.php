<?php
/**
 * RSS Fetcher Service
 *
 * @package Feeds
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Feeds_RSS_Fetcher class
 */
class Feeds_RSS_Fetcher {
	/**
	 * Single instance of the class
	 *
	 * @var Feeds_RSS_Fetcher
	 */
	private static $instance = null;

	/**
	 * Get single instance of the class
	 *
	 * @return Feeds_RSS_Fetcher
	 */
	public static function get_instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor
	 */
	private function __construct() {
		// Register REST API endpoint for manual refresh.
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
	}

	/**
	 * Register REST API routes
	 */
	public function register_rest_routes() {
		register_rest_route(
			'feeds/v1',
			'/refresh/(?P<id>\d+)',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'refresh_single_feed' ),
				'permission_callback' => function() {
					return current_user_can( 'manage_options' );
				},
				'args'                => array(
					'id' => array(
						'required'          => true,
						'validate_callback' => function( $param ) {
							return is_numeric( $param );
						},
					),
				),
			)
		);
	}

	/**
	 * Fetch all active feeds
	 */
	public function fetch_all_feeds() {
		$sources = get_posts(
			array(
				'post_type'      => Feeds_Feed_Source_CPT::POST_TYPE,
				'posts_per_page' => -1,
				'post_status'    => 'publish',
			)
		);

		foreach ( $sources as $source ) {
			$this->fetch_feed( $source->ID );
		}
	}

	/**
	 * Fetch a single feed
	 *
	 * @param int $source_id Feed source post ID.
	 * @return bool|WP_Error True on success, WP_Error on failure.
	 */
	public function fetch_feed( $source_id ) {
		$feed_url = get_post_meta( $source_id, '_feeds_source_url', true );

		if ( empty( $feed_url ) ) {
			return new WP_Error( 'no_url', __( 'No feed URL found', 'feeds' ) );
		}

		// Fetch the feed using WordPress SimplePie wrapper.
		require_once ABSPATH . WPINC . '/feed.php';
		$rss = fetch_feed( $feed_url );

		if ( is_wp_error( $rss ) ) {
			// Update source with error status.
			update_post_meta( $source_id, '_feeds_fetch_status', 'error' );
			update_post_meta( $source_id, '_feeds_error_message', $rss->get_error_message() );
			update_post_meta( $source_id, '_feeds_last_fetched', time() );
			return $rss;
		}

		// Get site URL from feed.
		$site_url = $rss->get_link();
		if ( $site_url ) {
			update_post_meta( $source_id, '_feeds_site_url', $site_url );
		}

		// Get feed categories for inheritance.
		$source_categories = wp_get_object_terms( $source_id, 'feeds_category', array( 'fields' => 'ids' ) );

		// Process feed items.
		$max_items = 50; // Limit items per fetch.
		foreach ( $rss->get_items( 0, $max_items ) as $item ) {
			$this->process_feed_item( $item, $source_id, $source_categories );
		}

		// Update source with success status.
		update_post_meta( $source_id, '_feeds_fetch_status', 'success' );
		update_post_meta( $source_id, '_feeds_error_message', '' );
		update_post_meta( $source_id, '_feeds_last_fetched', time() );

		return true;
	}

	/**
	 * Process a single feed item
	 *
	 * @param SimplePie_Item $item Feed item.
	 * @param int            $source_id Feed source post ID.
	 * @param array          $categories Category IDs to assign.
	 */
	private function process_feed_item( $item, $source_id, $categories = array() ) {
		$guid = $item->get_id();

		// Check if item already exists.
		$existing = get_posts(
			array(
				'post_type'      => Feeds_Feed_Item_CPT::POST_TYPE,
				'post_status'    => 'any',
				'posts_per_page' => 1,
				'meta_query'     => array(
					array(
						'key'   => '_feeds_item_permalink',
						'value' => $item->get_permalink(),
					),
				),
			)
		);

		if ( ! empty( $existing ) ) {
			return; // Item already exists.
		}

		// Prepare post data.
		$post_data = array(
			'post_type'    => Feeds_Feed_Item_CPT::POST_TYPE,
			'post_title'   => $item->get_title() ? $item->get_title() : __( 'Untitled', 'feeds' ),
			'post_content' => $item->get_content() ? $item->get_content() : $item->get_description(),
			'post_excerpt' => $item->get_description( true ),
			'post_status'  => 'publish',
			'post_date'    => $item->get_date( 'Y-m-d H:i:s' ) ? $item->get_date( 'Y-m-d H:i:s' ) : current_time( 'mysql' ),
		);

		// Insert the post.
		$post_id = wp_insert_post( $post_data );

		if ( is_wp_error( $post_id ) || ! $post_id ) {
			return;
		}

		// Add meta data.
		update_post_meta( $post_id, '_feeds_item_source_id', $source_id );
		update_post_meta( $post_id, '_feeds_item_permalink', $item->get_permalink() );

		// Author.
		$author = $item->get_author();
		if ( $author ) {
			update_post_meta( $post_id, '_feeds_item_author', $author->get_name() );
		}

		// Publication date.
		$pub_date = $item->get_date( 'U' );
		if ( $pub_date ) {
			update_post_meta( $post_id, '_feeds_item_pub_date', $pub_date );
		}

		// Thumbnail.
		$enclosure = $item->get_enclosure();
		if ( $enclosure && $enclosure->get_thumbnail() ) {
			update_post_meta( $post_id, '_feeds_item_thumbnail_url', $enclosure->get_thumbnail() );
		} elseif ( $enclosure && $enclosure->get_link() ) {
			// Check if enclosure is an image.
			$type = $enclosure->get_type();
			if ( $type && strpos( $type, 'image/' ) === 0 ) {
				update_post_meta( $post_id, '_feeds_item_thumbnail_url', $enclosure->get_link() );
			}
		}

		// Assign categories from source.
		if ( ! empty( $categories ) && ! is_wp_error( $categories ) ) {
			wp_set_object_terms( $post_id, $categories, 'feeds_category' );
		}
	}

	/**
	 * REST API callback to refresh a single feed
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object.
	 */
	public function refresh_single_feed( $request ) {
		$source_id = $request->get_param( 'id' );

		$result = $this->fetch_feed( $source_id );

		if ( is_wp_error( $result ) ) {
			return new WP_Error(
				'fetch_failed',
				$result->get_error_message(),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Feed refreshed successfully', 'feeds' ),
			)
		);
	}
}
