<?php
/**
 * Scheduler Service for Background Processing
 * Uses Action Scheduler for reliable queued feed fetching
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
		// Register action hooks for Action Scheduler.
		add_action( 'feeds_check_due', array( $this, 'check_due_feeds' ) );
		add_action( 'feeds_fetch_single', array( $this, 'fetch_single_feed' ) );

		// Schedule recurring check on init (after Action Scheduler is loaded).
		add_action( 'init', array( $this, 'schedule_recurring_check' ), 20 );

		// Clean up on deactivation.
		register_deactivation_hook( FEEDS_PLUGIN_DIR . 'feeds.php', array( $this, 'unschedule_events' ) );
	}

	/**
	 * Schedule the recurring check for due feeds
	 */
	public function schedule_recurring_check() {
		// Only schedule if Action Scheduler is available.
		if ( ! function_exists( 'as_has_scheduled_action' ) ) {
			return;
		}

		// Schedule recurring action every 15 minutes if not already scheduled.
		if ( ! as_has_scheduled_action( 'feeds_check_due' ) ) {
			as_schedule_recurring_action( time(), 900, 'feeds_check_due', array(), 'feeds' );
		}
	}

	/**
	 * Check which feeds are due for fetching and queue them
	 */
	public function check_due_feeds() {
		$now = time();

		$sources = get_posts(
			array(
				'post_type'      => Feeds_Feed_Source_CPT::POST_TYPE,
				'posts_per_page' => -1,
				'post_status'    => 'publish',
				'fields'         => 'ids',
			)
		);

		foreach ( $sources as $source_id ) {
			$last_fetched = (int) get_post_meta( $source_id, '_feeds_last_fetched', true );
			$interval     = (int) get_post_meta( $source_id, '_feeds_refresh_interval', true );

			// Default to 1 hour if no interval set.
			if ( ! $interval ) {
				$interval = 3600;
			}

			// Check if feed is due for refresh.
			if ( $last_fetched + $interval <= $now ) {
				$this->schedule_single_fetch( $source_id );
			}
		}
	}

	/**
	 * Schedule a single feed fetch
	 *
	 * @param int $source_id Feed source post ID.
	 */
	public function schedule_single_fetch( $source_id ) {
		// Only schedule if Action Scheduler is available.
		if ( ! function_exists( 'as_has_scheduled_action' ) ) {
			// Fallback: fetch immediately if Action Scheduler not available.
			$this->fetch_single_feed( $source_id );
			return;
		}

		// Queue async action if not already pending.
		if ( ! as_has_scheduled_action( 'feeds_fetch_single', array( $source_id ), 'feeds' ) ) {
			as_enqueue_async_action( 'feeds_fetch_single', array( $source_id ), 'feeds' );
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
	 * Unschedule all events on plugin deactivation
	 */
	public function unschedule_events() {
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			as_unschedule_all_actions( 'feeds_check_due', array(), 'feeds' );
			as_unschedule_all_actions( 'feeds_fetch_single', null, 'feeds' );
		}
	}
}
