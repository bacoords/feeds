<?php
/**
 * Plugin Name: Feeds
 * Plugin URI: https://www.briancoords.com
 * Description: A self-hosted RSS reader living natively inside the WordPress Admin Dashboard
 * Version: 0.2.5
 * Author: Brian Coords
 * Author URI: https://www.briancoords.com
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: feeds
 * Domain Path: /languages
 *
 * @package Feeds
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Define plugin constants.
define( 'FEEDS_VERSION', '0.2.5' );
define( 'FEEDS_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'FEEDS_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'FEEDS_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );

// Load Composer autoloader.
if ( file_exists( FEEDS_PLUGIN_DIR . 'vendor/autoload.php' ) ) {
	require_once FEEDS_PLUGIN_DIR . 'vendor/autoload.php';
}

/**
 * Main Feeds Plugin Class
 */
class Feeds_Plugin {
	/**
	 * Single instance of the class
	 *
	 * @var Feeds_Plugin
	 */
	private static $instance = null;

	/**
	 * Get single instance of the class
	 *
	 * @return Feeds_Plugin
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
		$this->load_dependencies();
		$this->init_hooks();
	}

	/**
	 * Load plugin dependencies
	 */
	private function load_dependencies() {
		// CPT classes.
		require_once FEEDS_PLUGIN_DIR . 'includes/CPT/class-feed-source-cpt.php';
		require_once FEEDS_PLUGIN_DIR . 'includes/CPT/class-feed-item-cpt.php';

		// Core classes.
		require_once FEEDS_PLUGIN_DIR . 'includes/class-rss-fetcher.php';
		require_once FEEDS_PLUGIN_DIR . 'includes/class-scheduler.php';
		require_once FEEDS_PLUGIN_DIR . 'includes/class-asset-loader.php';

		// WP-CLI commands.
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			require_once FEEDS_PLUGIN_DIR . 'includes/class-cli-commands.php';
		}
	}

	/**
	 * Initialize hooks
	 */
	private function init_hooks() {
		add_action( 'init', array( $this, 'init' ) );
		add_action( 'admin_menu', array( $this, 'add_admin_menu' ) );

		// Initialize CPTs.
		Feeds_Feed_Source_CPT::get_instance();
		Feeds_Feed_Item_CPT::get_instance();

		// Initialize core services.
		Feeds_RSS_Fetcher::get_instance();
		Feeds_Scheduler::get_instance();
		Feeds_Asset_Loader::get_instance();

		// Register WP-CLI commands.
		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			Feeds_CLI_Commands::register_commands();
		}
	}

	/**
	 * Initialize plugin
	 */
	public function init() {
		// Load text domain.
		load_plugin_textdomain( 'feeds', false, dirname( FEEDS_PLUGIN_BASENAME ) . '/languages' );
	}

	/**
	 * Add admin menu page
	 */
	public function add_admin_menu() {
		add_menu_page(
			__( 'Feeds', 'feeds' ),
			__( 'Feeds', 'feeds' ),
			'manage_options',
			'feeds',
			array( $this, 'render_admin_page' ),
			'dashicons-rss',
			30
		);
	}

	/**
	 * Render admin page
	 */
	public function render_admin_page() {
		echo '<div id="feeds-app"></div>';
	}
}

/**
 * Initialize the plugin
 */
function feeds_init() {
	return Feeds_Plugin::get_instance();
}

/**
 * Plugin activation hook
 */
function feeds_activate() {
	// Load dependencies first.
	require_once FEEDS_PLUGIN_DIR . 'includes/CPT/class-feed-source-cpt.php';
	require_once FEEDS_PLUGIN_DIR . 'includes/CPT/class-feed-item-cpt.php';

	// Register the CPT.
	Feeds_Feed_Item_CPT::get_instance()->register_post_type();

	// Flush rewrite rules.
	flush_rewrite_rules();
}

// Register activation hook.
register_activation_hook( __FILE__, 'feeds_activate' );

// Start the plugin.
feeds_init();
