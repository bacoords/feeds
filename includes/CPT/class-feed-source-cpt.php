<?php
/**
 * Feed Source Custom Post Type
 *
 * @package Feeds
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Feeds_Feed_Source_CPT class
 */
class Feeds_Feed_Source_CPT {
	/**
	 * Post type name
	 *
	 * @var string
	 */
	const POST_TYPE = 'feeds_source';

	/**
	 * Single instance of the class
	 *
	 * @var Feeds_Feed_Source_CPT
	 */
	private static $instance = null;

	/**
	 * Get single instance of the class
	 *
	 * @return Feeds_Feed_Source_CPT
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
		add_action( 'delete_post_' . self::POST_TYPE, array( $this, 'handle_post_deletion' ) );
	}

	/**
	 * Register the custom post type
	 */
	public function register_post_type() {
		$args = array(
			'label'               => __( 'Feed Sources', 'feeds' ),
			'public'              => false,
			'publicly_queryable'  => false,
			'show_ui'             => false,
			'show_in_menu'        => false,
			'show_in_rest'        => true,
			'rest_base'           => 'feeds_source',
			'capability_type'     => 'post',
			'hierarchical'        => false,
			'supports'            => array( 'title', 'custom-fields' ),
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
	 * Register meta fields for REST API access
	 */
	public function register_meta_fields() {
		// Source URL.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_source_url',
			array(
				'type'          => 'string',
				'description'   => __( 'The RSS/XML feed URL', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Site URL.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_site_url',
			array(
				'type'          => 'string',
				'description'   => __( 'The homepage URL of the source', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Last Fetched.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_last_fetched',
			array(
				'type'          => 'integer',
				'description'   => __( 'Timestamp when the feed was last fetched', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		// Error Message.
		register_post_meta(
			self::POST_TYPE,
			'_feeds_error_message',
			array(
				'type'          => 'string',
				'description'   => __( 'Error message if fetch failed', 'feeds' ),
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => function() {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}

	/**
	 * Handle post deletion cleanup
	 *
	 * @param int $post_id The ID of the deleted post.
	 */
	public function handle_post_deletion( $post_id ) {
		// Delete all feed items associated with this source.
		$feed_items = get_posts( array(
			'post_type'      => Feeds_Feed_Item_CPT::POST_TYPE,
			'meta_key'       => '_feeds_source_id',
			'meta_value'     => $post_id,
			'posts_per_page' => -1,				
		) );

		foreach ( $feed_items as $item ) {
			wp_delete_post( $item->ID, true );
		}
	}	
}