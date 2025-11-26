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

		register_rest_route(
			'feeds/v1',
			'/import-opml',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'import_opml' ),
				'permission_callback' => function() {
					return current_user_can( 'manage_options' );
				},
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
			// Update source with error status (using pending post_status).
			wp_update_post(
				array(
					'ID'          => $source_id,
					'post_status' => 'pending',
				)
			);
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

		// Update source with success status (using publish post_status).
		wp_update_post(
			array(
				'ID'          => $source_id,
				'post_status' => 'publish',
			)
		);
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
		// Check item age - skip if too old.
		$max_age_days = apply_filters( 'feeds_import_max_age_days', 7 );
		$item_date    = $item->get_date( 'U' );
		$cutoff_date  = strtotime( "-{$max_age_days} days" );

		if ( $item_date && $item_date < $cutoff_date ) {
			return; // Item is too old, skip it.
		}

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

		// Thumbnail - try multiple methods.
		$thumbnail_url = null;

		// Method 1: Try enclosure thumbnail.
		$enclosure = $item->get_enclosure();
		if ( $enclosure && $enclosure->get_thumbnail() ) {
			$thumbnail_url = $enclosure->get_thumbnail();
		}

		// Method 2: Try image enclosure.
		if ( ! $thumbnail_url && $enclosure && $enclosure->get_link() ) {
			$type = $enclosure->get_type();
			if ( $type && strpos( $type, 'image/' ) === 0 ) {
				$thumbnail_url = $enclosure->get_link();
			}
		}

		// Method 3: Try all enclosures for images.
		if ( ! $thumbnail_url ) {
			$enclosures = $item->get_enclosures();
			if ( $enclosures ) {
				foreach ( $enclosures as $enclosure_item ) {
					// First try thumbnail.
					if ( $enclosure_item->get_thumbnail() ) {
						$thumbnail_url = $enclosure_item->get_thumbnail();
						break;
					}
					// Then try image type.
					$type = $enclosure_item->get_type();
					if ( $type && strpos( $type, 'image/' ) === 0 ) {
						$thumbnail_url = $enclosure_item->get_link();
						break;
					}
				}
			}
		}

		// Method 4: Try media:thumbnail from item tags.
		if ( ! $thumbnail_url ) {
			$media_thumbnail = $item->get_item_tags( 'http://search.yahoo.com/mrss/', 'thumbnail' );
			if ( $media_thumbnail && isset( $media_thumbnail[0]['attribs']['']['url'] ) ) {
				$thumbnail_url = $media_thumbnail[0]['attribs']['']['url'];
			}
		}

		// Method 5: Try media:content for images.
		if ( ! $thumbnail_url ) {
			$media_content = $item->get_item_tags( 'http://search.yahoo.com/mrss/', 'content' );
			if ( $media_content ) {
				foreach ( $media_content as $content ) {
					if ( isset( $content['attribs']['']['medium'] ) && $content['attribs']['']['medium'] === 'image' ) {
						if ( isset( $content['attribs']['']['url'] ) ) {
							$thumbnail_url = $content['attribs']['']['url'];
							break;
						}
					} elseif ( isset( $content['attribs']['']['type'] ) && strpos( $content['attribs']['']['type'], 'image/' ) === 0 ) {
						if ( isset( $content['attribs']['']['url'] ) ) {
							$thumbnail_url = $content['attribs']['']['url'];
							break;
						}
					}
				}
			}
		}

		// Method 6: Extract first image from HTML content.
		if ( ! $thumbnail_url ) {
			$content = $item->get_content();
			if ( $content ) {
				// Use regex to find the first img tag with src attribute.
				if ( preg_match( '/<img[^>]+src=["\']([^"\']+)["\'][^>]*>/i', $content, $matches ) ) {
					$thumbnail_url = $matches[1];
				}
			}
		}

		// Save thumbnail if found.
		if ( $thumbnail_url ) {
			update_post_meta( $post_id, '_feeds_item_thumbnail_url', $thumbnail_url );
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

	/**
	 * REST API callback to import OPML file
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object.
	 */
	public function import_opml( $request ) {
		$files = $request->get_file_params();

		if ( empty( $files['file'] ) ) {
			return new WP_Error(
				'no_file',
				__( 'No file uploaded', 'feeds' ),
				array( 'status' => 400 )
			);
		}

		$file = $files['file'];

		// Check file type.
		$allowed_types = array( 'text/xml', 'application/xml', 'text/x-opml', 'application/octet-stream' );
		if ( ! in_array( $file['type'], $allowed_types, true ) && ! preg_match( '/\.opml$/i', $file['name'] ) ) {
			return new WP_Error(
				'invalid_file_type',
				__( 'Please upload a valid OPML file', 'feeds' ),
				array( 'status' => 400 )
			);
		}

		// Read file contents.
		$opml_content = file_get_contents( $file['tmp_name'] );

		if ( empty( $opml_content ) ) {
			return new WP_Error(
				'empty_file',
				__( 'The uploaded file is empty', 'feeds' ),
				array( 'status' => 400 )
			);
		}

		// Parse OPML.
		$xml = simplexml_load_string( $opml_content );

		if ( false === $xml ) {
			return new WP_Error(
				'invalid_opml',
				__( 'Failed to parse OPML file', 'feeds' ),
				array( 'status' => 400 )
			);
		}

		$imported = 0;
		$skipped  = 0;

		// Process outline elements (feeds).
		if ( isset( $xml->body->outline ) ) {
			foreach ( $xml->body->outline as $outline ) {
				$result = $this->process_opml_outline( $outline );
				if ( $result ) {
					$imported += $result['imported'];
					$skipped  += $result['skipped'];
				}
			}
		}

		return rest_ensure_response(
			array(
				'success'  => true,
				'imported' => $imported,
				'skipped'  => $skipped,
				'message'  => sprintf(
					__( 'OPML import complete. Imported: %d, Skipped: %d', 'feeds' ),
					$imported,
					$skipped
				),
			)
		);
	}

	/**
	 * Process OPML outline element recursively
	 *
	 * @param SimpleXMLElement $outline Outline element.
	 * @param array            $categories Category IDs to assign.
	 * @return array Count of imported and skipped feeds.
	 */
	private function process_opml_outline( $outline, $categories = array() ) {
		$imported = 0;
		$skipped  = 0;

		// Check if this is a folder/category.
		if ( isset( $outline['text'] ) && ! isset( $outline['xmlUrl'] ) ) {
			// This is a category/folder.
			$category_name = (string) $outline['text'];

			// Create or get category term.
			$term = term_exists( $category_name, 'feeds_category' );
			if ( ! $term ) {
				$term = wp_insert_term( $category_name, 'feeds_category' );
			}

			if ( ! is_wp_error( $term ) && isset( $term['term_id'] ) ) {
				$cat_ids = array_merge( $categories, array( $term['term_id'] ) );

				// Process child outlines.
				if ( isset( $outline->outline ) ) {
					foreach ( $outline->outline as $child ) {
						$result    = $this->process_opml_outline( $child, $cat_ids );
						$imported += $result['imported'];
						$skipped  += $result['skipped'];
					}
				}
			}
		} elseif ( isset( $outline['xmlUrl'] ) ) {
			// This is a feed.
			$feed_url  = (string) $outline['xmlUrl'];
			$feed_name = isset( $outline['title'] ) ? (string) $outline['title'] : ( isset( $outline['text'] ) ? (string) $outline['text'] : $feed_url );

			// Check if feed already exists.
			$existing = get_posts(
				array(
					'post_type'      => Feeds_Feed_Source_CPT::POST_TYPE,
					'post_status'    => 'any',
					'posts_per_page' => 1,
					'meta_query'     => array(
						array(
							'key'   => '_feeds_source_url',
							'value' => $feed_url,
						),
					),
				)
			);

			if ( ! empty( $existing ) ) {
				$skipped++;
			} else {
				// Create new feed source.
				$post_id = wp_insert_post(
					array(
						'post_type'   => Feeds_Feed_Source_CPT::POST_TYPE,
						'post_title'  => $feed_name,
						'post_status' => 'publish',
					)
				);

				if ( ! is_wp_error( $post_id ) && $post_id ) {
					update_post_meta( $post_id, '_feeds_source_url', $feed_url );

					// Assign categories.
					if ( ! empty( $categories ) ) {
						wp_set_object_terms( $post_id, $categories, 'feeds_category' );
					}

					$imported++;

					// Schedule the feed fetch to happen in the background.
					$scheduler = Feeds_Scheduler::get_instance();
					$scheduler->schedule_single_fetch( $post_id );
				} else {
					$skipped++;
				}
			}
		}

		return array(
			'imported' => $imported,
			'skipped'  => $skipped,
		);
	}
}
