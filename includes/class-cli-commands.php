<?php
/**
 * WP-CLI Commands for Feeds Plugin
 *
 * @package Feeds
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Feeds_CLI_Commands class
 */
class Feeds_CLI_Commands {

	/**
	 * Registers commands for managing feeds.
	 */
	public static function register_commands() {
		WP_CLI::add_command( 'feeds sources fetch', array( 'Feeds_CLI_Commands', 'sources_fetch' ) );
		WP_CLI::add_command( 'feeds sources delete', array( 'Feeds_CLI_Commands', 'sources_delete' ) );
		WP_CLI::add_command( 'feeds items delete', array( 'Feeds_CLI_Commands', 'items_delete' ) );
	}

	/**
	 * Fetches all feeds without deleting existing items.
	 *
	 * ## EXAMPLES
	 *
	 *     wp feeds sources fetch
	 *
	 * @when after_wp_load
	 */
	public function sources_fetch( $args, $assoc_args ) {
		WP_CLI::line( 'Fetching all feeds...' );
		$fetcher = Feeds_RSS_Fetcher::get_instance();
		$fetcher->fetch_all_feeds();
		WP_CLI::success( 'All feeds fetched successfully.' );
	}

	/**
	 * Deletes all feed sources and all feed items (complete reset).
	 *
	 * ## EXAMPLES
	 *
	 *     wp feeds sources delete
	 *
	 * @when after_wp_load
	 */
	public function sources_delete( $args, $assoc_args ) {
		WP_CLI::confirm( 'Are you sure you want to delete ALL feeds and feed items? This cannot be undone.' );

		// Step 1: Delete all feed items.
		WP_CLI::line( 'Deleting all feed items...' );
		$deleted_items = $this->delete_all_feed_items();
		WP_CLI::success( sprintf( 'Deleted %d feed items.', $deleted_items ) );

		// Step 2: Delete all feed sources.
		WP_CLI::line( 'Deleting all feed sources...' );
		$deleted_sources = $this->delete_all_feed_sources();
		WP_CLI::success( sprintf( 'Deleted %d feed sources.', $deleted_sources ) );

		WP_CLI::success( 'All feeds and feed items have been deleted.' );
	}

	/**
	 * Deletes all feed items only (keeps sources).
	 *
	 * ## EXAMPLES
	 *
	 *     wp feeds items delete
	 *
	 * @when after_wp_load
	 */
	public function items_delete( $args, $assoc_args ) {
		WP_CLI::confirm( 'Are you sure you want to delete all feed items? This cannot be undone.' );

		WP_CLI::line( 'Deleting all feed items...' );
		$deleted = $this->delete_all_feed_items();
		WP_CLI::success( sprintf( 'Deleted %d feed items.', $deleted ) );
	}

	/**
	 * Helper function to delete all feed items
	 *
	 * @return int Number of items deleted.
	 */
	private function delete_all_feed_items() {
		global $wpdb;

		// Get all feed item IDs.
		$post_ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type = %s",
				Feeds_Feed_Item_CPT::POST_TYPE
			)
		);

		if ( empty( $post_ids ) ) {
			return 0;
		}

		$deleted = 0;

		foreach ( $post_ids as $post_id ) {
			if ( wp_delete_post( $post_id, true ) ) {
				$deleted++;
			}
		}

		return $deleted;
	}

	/**
	 * Helper function to delete all feed sources
	 *
	 * @return int Number of sources deleted.
	 */
	private function delete_all_feed_sources() {
		global $wpdb;

		// Get all feed source IDs.
		$post_ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type = %s",
				Feeds_Feed_Source_CPT::POST_TYPE
			)
		);

		if ( empty( $post_ids ) ) {
			return 0;
		}

		$deleted = 0;

		foreach ( $post_ids as $post_id ) {
			if ( wp_delete_post( $post_id, true ) ) {
				$deleted++;
			}
		}

		return $deleted;
	}
}
