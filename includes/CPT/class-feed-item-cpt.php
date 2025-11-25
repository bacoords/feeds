<?php
/**
 * Feed Item Custom Post Type
 *
 * @package Feeds
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Feeds_Feed_Item_CPT class
 */
class Feeds_Feed_Item_CPT {
	/**
	 * Post type name
	 *
	 * @var string
	 */
	const POST_TYPE = 'feeds_item';

	/**
	 * Single instance of the class
	 *
	 * @var Feeds_Feed_Item_CPT
	 */
	private static $instance = null;

	/**
	 * Get single instance of the class
	 *
	 * @return Feeds_Feed_Item_CPT
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
		add_action( 'init', array( $this, 'register_post_type' ) );
		add_action( 'init', array( $this, 'register_meta_fields' ) );
		add_action( 'init', array( $this, 'register_taxonomy' ) );
		add_filter( 'rest_feeds_item_query', array( $this, 'filter_rest_query_by_meta' ), 10, 2 );
		add_filter( 'rest_prepare_feeds_item', array( $this, 'filter_rest_prepare_excerpt' ), 10, 3 );
	}

	/**
	 * Register the custom post type
	 */
	public function register_post_type() {
		$args = array(
			'label'               => __( 'Feed Items', 'feeds' ),
			'public'              => false,
			'publicly_queryable'  => false,
			'show_ui'             => false,
			'show_in_menu'        => false,
			'show_in_rest'        => true,
			'rest_base'           => 'feed_items',
			'capability_type'     => 'post',
			'hierarchical'        => false,
			'supports'            => array( 'title', 'editor', 'excerpt', 'custom-fields' ),
			'has_archive'         => false,
			'rewrite'             => false,
			'query_var'           => false,
			'can_export'          => true,
			'delete_with_user'    => false,
			'taxonomies'          => array( 'feeds_category' ),
		);

		register_post_type( self::POST_TYPE, $args );
	}

	/**
	 * Register feed category taxonomy
	 */
	public function register_taxonomy() {
		$args = array(
			'label'             => __( 'Feed Categories', 'feeds' ),
			'public'            => false,
			'publicly_queryable' => false,
			'show_ui'           => false,
			'show_in_menu'      => false,
			'show_in_rest'      => true,
			'rest_base'         => 'feed_categories',
			'hierarchical'      => true,
			'show_admin_column' => false,
			'rewrite'           => false,
			'query_var'         => false,
		);

		register_taxonomy(
			'feeds_category',
			array( self::POST_TYPE, Feeds_Feed_Source_CPT::POST_TYPE ),
			$args
		);
	}

	/**
	 * Register meta fields for REST API access
	 */
	public function register_meta_fields() {
		// Author.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_item_author',
			array(
				'type'          => 'string',
				'description'   => __( 'Author name from the feed', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Thumbnail URL.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_item_thumbnail_url',
			array(
				'type'          => 'string',
				'description'   => __( 'Remote URL of the featured image', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Permalink.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_item_permalink',
			array(
				'type'          => 'string',
				'description'   => __( 'Original URL of the feed item', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Source ID.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_item_source_id',
			array(
				'type'          => 'integer',
				'description'   => __( 'ID of the parent feed source', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Publication Date.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_item_pub_date',
			array(
				'type'          => 'integer',
				'description'   => __( 'Original publication date timestamp', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Read.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_item_is_read',
			array(
				'type'          => 'boolean',
				'description'   => __( 'Whether an item is read or not', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Favorite.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_item_is_favorite',
			array(
				'type'          => 'boolean',
				'description'   => __( 'Whether an item is favorited or not', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}

	/**
	 * Filter REST API query by custom meta parameters
	 *
	 * @param array           $args    Query args.
	 * @param WP_REST_Request $request REST request.
	 * @return array Modified query args.
	 */
	public function filter_rest_query_by_meta( $args, $request ) {
		// Handle is_read parameter.
		if ( isset( $request['is_read'] ) ) {
			if ( ! isset( $args['meta_query'] ) ) {
				$args['meta_query'] = array();
			}

			$args['meta_query'][] = array(
				'key'     => '_feeds_item_is_read',
				'value'   => rest_sanitize_boolean( $request['is_read'] ) ? '1' : '0',
				'compare' => '=',
			);
		}

		// Handle is_favorite parameter.
		if ( isset( $request['is_favorite'] ) ) {
			if ( ! isset( $args['meta_query'] ) ) {
				$args['meta_query'] = array();
			}

			$args['meta_query'][] = array(
				'key'     => '_feeds_item_is_favorite',
				'value'   => rest_sanitize_boolean( $request['is_favorite'] ) ? '1' : '0',
				'compare' => '=',
			);
		}

		return $args;
	}

	/**
	 * Mark all read posts as draft
	 * This function finds all posts with the 'read' meta key set to true
	 * and changes their post_status to 'draft'
	 */
	public static function mark_read_posts_as_draft() {
		// Query for all published posts with _feeds_item_is_read = true.
		$args = array(
			'post_type'      => self::POST_TYPE,
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'meta_query'     => array(
				array(
					'key'     => '_feeds_item_is_read',
					'value'   => '1',
					'compare' => '=',
				),
			),
		);

		$read_posts = get_posts( $args );

		// Update each post to draft status.
		foreach ( $read_posts as $post_id ) {
			wp_update_post(
				array(
					'ID'          => $post_id,
					'post_status' => 'draft',
				)
			);
		}

		// Log the action if any posts were updated.
		if ( ! empty( $read_posts ) ) {
			error_log( sprintf( 'Feeds: Marked %d read posts as draft', count( $read_posts ) ) );
		}
	}

	/**
	 * Filter REST API response to clean up excerpt
	 *
	 * @param WP_REST_Response $response Response object.
	 * @param WP_Post          $post     Post object.
	 * @param WP_REST_Request  $request  Request object.
	 * @return WP_REST_Response Modified response.
	 */
	public function filter_rest_prepare_excerpt( $response, $post, $request ) {
		$data = $response->get_data();

		// Clean up excerpt if it exists.
		if ( isset( $data['excerpt']['rendered'] ) ) {
			$excerpt = $data['excerpt']['rendered'];

			// Strip all HTML tags.
			$excerpt = wp_strip_all_tags( $excerpt );

			// Limit to 300 characters.
			$char_limit = apply_filters( 'feeds_excerpt_char_limit', 300 );
			if ( strlen( $excerpt ) > $char_limit ) {
				$excerpt = substr( $excerpt, 0, $char_limit );
				// Try to break at a word boundary.
				$last_space = strrpos( $excerpt, ' ' );
				if ( $last_space !== false ) {
					$excerpt = substr( $excerpt, 0, $last_space );
				}
				$excerpt .= '…';
			}

			// Update the response.
			$data['excerpt']['rendered'] = $excerpt;
			$response->set_data( $data );
		}

		return $response;
	}
}
