<?php
/**
 * Feeds Label Taxonomy
 *
 * @package Feeds
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Feeds_Label_Taxonomy class
 */
class Feeds_Label_Taxonomy {
	/**
	 * Single instance of the class
	 *
	 * @var Feeds_Label_Taxonomy
	 */
	private static $instance = null;

	/**
	 * Taxonomy name
	 */
	const TAXONOMY = 'feeds_label';

	/**
	 * Get single instance of the class
	 *
	 * @return Feeds_Label_Taxonomy
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
		add_action( 'init', array( $this, 'register_taxonomy' ) );
	}

	/**
	 * Register the taxonomy
	 */
	public function register_taxonomy() {
		$labels = array(
			'name'              => __( 'Labels', 'feeds' ),
			'singular_name'     => __( 'Label', 'feeds' ),
			'search_items'      => __( 'Search Labels', 'feeds' ),
			'all_items'         => __( 'All Labels', 'feeds' ),
			'edit_item'         => __( 'Edit Label', 'feeds' ),
			'update_item'       => __( 'Update Label', 'feeds' ),
			'add_new_item'      => __( 'Add New Label', 'feeds' ),
			'new_item_name'     => __( 'New Label Name', 'feeds' ),
			'menu_name'         => __( 'Labels', 'feeds' ),
		);

		$args = array(
			'labels'            => $labels,
			'hierarchical'      => false,
			'public'            => true,
			'show_ui'           => true,
			'show_admin_column' => true,
			'show_in_rest'      => true,
			'rest_base'         => 'feeds_label',
			'query_var'         => true,
			'rewrite'           => array( 'slug' => 'feeds-label' ),
			'show_in_menu'      => false,
		);

		register_taxonomy( self::TAXONOMY, array( Feeds_Feed_Item_CPT::POST_TYPE ), $args );
	}

	/**
	 * Create default label terms
	 */
	public static function create_default_terms() {
		$default_terms = array(
			'favorite' => __( 'Favorite', 'feeds' ),
			'read'     => __( 'Read', 'feeds' ),
		);

		foreach ( $default_terms as $slug => $name ) {
			if ( ! term_exists( $slug, self::TAXONOMY ) ) {
				wp_insert_term(
					$name,
					self::TAXONOMY,
					array(
						'slug' => $slug,
					)
				);
			}
		}
	}
}
