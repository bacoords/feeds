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
	}
}
