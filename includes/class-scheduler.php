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
		add_action( 'feeds_prune_items', array( $this, 'prune_old_items' ) );

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

		// Schedule daily pruning.
		if ( ! wp_next_scheduled( 'feeds_prune_items' ) ) {
			wp_schedule_event( time(), 'daily', 'feeds_prune_items' );
		}
	}

	/**
	 * Unschedule all events
	 */
	public function unschedule_events() {
		wp_clear_scheduled_hook( 'feeds_fetch_all' );
		wp_clear_scheduled_hook( 'feeds_prune_items' );
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

	/**
	 * Prune old feed items
	 * Runs daily to delete old items that aren't favorited
	 */
	public function prune_old_items() {
		// Get retention days from settings (default 30 days).
		$retention_days = apply_filters( 'feeds_retention_days', 30 );
		$cutoff_date    = strtotime( "-{$retention_days} days" );

		// Query old, non-favorited items.
		$old_items = get_posts(
			array(
				'post_type'      => Feeds_Feed_Item_CPT::POST_TYPE,
				'posts_per_page' => 100, // Process in batches.
				'post_status'    => 'publish',
				'date_query'     => array(
					array(
						'before' => date( 'Y-m-d', $cutoff_date ),
					),
				),
				'meta_query'     => array(
					'relation' => 'OR',
					array(
						'key'     => '_feeds_item_is_favorite',
						'value'   => '0',
						'compare' => '=',
					),
					array(
						'key'     => '_feeds_item_is_favorite',
						'compare' => 'NOT EXISTS',
					),
				),
				'fields'         => 'ids',
			)
		);

		foreach ( $old_items as $item_id ) {
			wp_delete_post( $item_id, true );
		}

		// Log the pruning.
		if ( ! empty( $old_items ) ) {
			error_log( sprintf( 'Feeds: Pruned %d old items', count( $old_items ) ) );
		}
	}
}
