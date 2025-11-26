<?php
/**
 * Scheduler Service for Background Processing
 * Uses Action Scheduler for reliable queued feed fetching
 * Each feed source has its own recurring scheduled action
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
		// Register action hook for fetching individual feeds.
		add_action( 'feeds_fetch_source', array( $this, 'fetch_and_reschedule' ) );

		// Schedule feed when source is created or updated.
		add_action( 'save_post_' . Feeds_Feed_Source_CPT::POST_TYPE, array( $this, 'on_source_saved' ), 10, 2 );

		// Unschedule feed when source is deleted.
		add_action( 'before_delete_post', array( $this, 'on_source_deleted' ) );

		// Clean up on deactivation.
		register_deactivation_hook( FEEDS_PLUGIN_DIR . 'feeds.php', array( $this, 'unschedule_all' ) );
	}

	/**
	 * Handle feed source save - schedule or reschedule the feed
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 */
	public function on_source_saved( $post_id, $post ) {
		// Don't schedule for auto-drafts or revisions.
		if ( wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) ) {
			return;
		}

		// Only schedule published feeds.
		if ( 'publish' !== $post->post_status ) {
			$this->unschedule_source( $post_id );
			return;
		}

		// Schedule this feed.
		$this->schedule_source( $post_id );
	}

	/**
	 * Handle feed source deletion - unschedule the feed
	 *
	 * @param int $post_id Post ID.
	 */
	public function on_source_deleted( $post_id ) {
		if ( get_post_type( $post_id ) !== Feeds_Feed_Source_CPT::POST_TYPE ) {
			return;
		}

		$this->unschedule_source( $post_id );
	}

	/**
	 * Schedule a feed source for recurring fetches
	 *
	 * @param int $source_id Feed source post ID.
	 */
	public function schedule_source( $source_id ) {
		if ( ! function_exists( 'as_schedule_single_action' ) ) {
			return;
		}

		// Unschedule any existing action for this source first.
		$this->unschedule_source( $source_id );

		// Get the interval for this feed (default 1 hour).
		$interval = (int) get_post_meta( $source_id, '_feeds_refresh_interval', true );
		if ( ! $interval ) {
			$interval = 3600;
		}

		// Get last fetched time.
		$last_fetched = (int) get_post_meta( $source_id, '_feeds_last_fetched', true );

		// Calculate next run time.
		$next_run = $last_fetched + $interval;

		// If next run is in the past, run soon (stagger by source ID to avoid thundering herd).
		if ( $next_run <= time() ) {
			$next_run = time() + ( $source_id % 60 ); // Stagger over 60 seconds.
		}

		// Schedule the next fetch.
		as_schedule_single_action( $next_run, 'feeds_fetch_source', array( $source_id ), 'feeds' );
	}

	/**
	 * Unschedule a feed source
	 *
	 * @param int $source_id Feed source post ID.
	 */
	public function unschedule_source( $source_id ) {
		if ( ! function_exists( 'as_unschedule_all_actions' ) ) {
			return;
		}

		as_unschedule_all_actions( 'feeds_fetch_source', array( $source_id ), 'feeds' );
	}

	/**
	 * Fetch a feed and reschedule the next fetch
	 *
	 * @param int $source_id Feed source post ID.
	 */
	public function fetch_and_reschedule( $source_id ) {
		// Verify the source still exists and is published.
		$post = get_post( $source_id );
		if ( ! $post || 'publish' !== $post->post_status || $post->post_type !== Feeds_Feed_Source_CPT::POST_TYPE ) {
			return;
		}

		// Fetch the feed.
		$fetcher = Feeds_RSS_Fetcher::get_instance();
		$fetcher->fetch_feed( $source_id );

		// Reschedule the next fetch.
		$this->schedule_source( $source_id );
	}

	/**
	 * Schedule a single feed fetch immediately (for manual refresh)
	 *
	 * @param int $source_id Feed source post ID.
	 */
	public function schedule_single_fetch( $source_id ) {
		if ( ! function_exists( 'as_enqueue_async_action' ) ) {
			// Fallback: fetch immediately if Action Scheduler not available.
			$fetcher = Feeds_RSS_Fetcher::get_instance();
			$fetcher->fetch_feed( $source_id );
			return;
		}

		// Unschedule existing and queue immediate fetch.
		$this->unschedule_source( $source_id );
		as_enqueue_async_action( 'feeds_fetch_source', array( $source_id ), 'feeds' );
	}

	/**
	 * Unschedule all feed actions on plugin deactivation
	 */
	public function unschedule_all() {
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			as_unschedule_all_actions( 'feeds_fetch_source', null, 'feeds' );
		}
	}
}
