<?php
/**
 * Scheduler Service for Background Processing
 *
 * @package Feeds
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Feeds_Scheduler class
 */
class Feeds_Scheduler {
	/**
	 * Single instance of the class
	 *
	 * @var Feeds_Scheduler
	 */
	private static $instance = null;

	/**
	 * Get single instance of the class
	 *
	 * @return Feeds_Scheduler
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
		// Register action hooks.
		add_action( 'feeds_fetch_all', array( $this, 'fetch_all_feeds' ) );
		add_action( 'feeds_fetch_single', array( $this, 'fetch_single_feed' ) );

		// Schedule recurring events on plugin activation.
		add_action( 'admin_init', array( $this, 'schedule_events' ) );

		// Clean up on deactivation.
		register_deactivation_hook( FEEDS_PLUGIN_DIR . 'feeds.php', array( $this, 'unschedule_events' ) );
	}

	/**
	 * Schedule recurring events
	 */
	public function schedule_events() {
		// Schedule hourly feed fetching.
		if ( ! wp_next_scheduled( 'feeds_fetch_all' ) ) {
			wp_schedule_event( time(), 'hourly', 'feeds_fetch_all' );
		}
	}

	/**
	 * Unschedule all events
	 */
	public function unschedule_events() {
		wp_clear_scheduled_hook( 'feeds_fetch_all' );
	}

	/**
	 * Fetch all feeds
	 * This is the main hourly job that schedules individual fetch jobs
	 */
	public function fetch_all_feeds() {
		$sources = get_posts(
			array(
				'post_type'      => Feeds_Feed_Source_CPT::POST_TYPE,
				'posts_per_page' => -1,
				'post_status'    => 'publish',
				'fields'         => 'ids',
			)
		);

		foreach ( $sources as $source_id ) {
			// Schedule individual fetch job.
			$this->schedule_single_fetch( $source_id );
		}
	}

	/**
	 * Schedule a single feed fetch
	 *
	 * @param int $source_id Feed source post ID.
	 */
	public function schedule_single_fetch( $source_id ) {
		// Check if already scheduled.
		if ( ! wp_next_scheduled( 'feeds_fetch_single', array( $source_id ) ) ) {
			wp_schedule_single_event( time(), 'feeds_fetch_single', array( $source_id ) );
		}
	}

	/**
	 * Fetch a single feed
	 *
	 * @param int $source_id Feed source post ID.
	 */
	public function fetch_single_feed( $source_id ) {
		$fetcher = Feeds_RSS_Fetcher::get_instance();
		$fetcher->fetch_feed( $source_id );
	}
}
