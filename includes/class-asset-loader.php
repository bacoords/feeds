<?php
/**
 * Asset Loader for React App
 *
 * @package Feeds
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Feeds_Asset_Loader class
 */
class Feeds_Asset_Loader {
	/**
	 * Single instance of the class
	 *
	 * @var Feeds_Asset_Loader
	 */
	private static $instance = null;

	/**
	 * Get single instance of the class
	 *
	 * @return Feeds_Asset_Loader
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
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
	}

	/**
	 * Enqueue scripts and styles
	 *
	 * @param string $hook Current admin page hook.
	 */
	public function enqueue_assets( $hook ) {
		// Only load on our plugin page.
		if ( 'toplevel_page_feeds' !== $hook ) {
			return;
		}

		$asset_file = FEEDS_PLUGIN_DIR . 'build/index.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = include $asset_file;

		wp_enqueue_style( 'global' );
		wp_enqueue_style( 'wp-edit-post' );
		wp_enqueue_style( 'wp-components' );	

		// Enqueue the main app script.
		wp_enqueue_script(
			'feeds-app',
			FEEDS_PLUGIN_URL . 'build/index.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		// Enqueue the stylesheet if it exists.
		if ( file_exists( FEEDS_PLUGIN_DIR . 'build/index.css' ) ) {
			wp_enqueue_style(
				'feeds-app',
				FEEDS_PLUGIN_URL . 'build/index.css',
				array( 'wp-components' ),
				$asset['version']
			);
		}

		// Localize script with data.
		wp_localize_script(
			'feeds-app',
			'feedsData',
			array(
				'apiUrl'    => rest_url( 'feeds/v1' ),
				'nonce'     => wp_create_nonce( 'wp_rest' ),
				'pluginUrl' => FEEDS_PLUGIN_URL,
			)
		);
	}
}
