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
	 * Deletes all feed items and refetches them from all feeds.
	 *
	 * ## EXAMPLES
	 *
	 *     wp feeds refresh-all
	 *
	 * @when after_wp_load
	 */
	public function refresh_all( $args, $assoc_args ) {
		WP_CLI::line( 'Starting feed refresh process...' );

		// Step 1: Delete all feed items.
		WP_CLI::line( 'Deleting all existing feed items...' );
		$deleted = $this->delete_all_feed_items();
		WP_CLI::success( sprintf( 'Deleted %d feed items.', $deleted ) );

		// Step 2: Fetch all feeds.
		WP_CLI::line( 'Fetching all feeds...' );
		$fetcher = Feeds_RSS_Fetcher::get_instance();

		// Get all feed sources.
		$sources = get_posts(
			array(
				'post_type'      => Feeds_Feed_Source_CPT::POST_TYPE,
				'posts_per_page' => -1,
				'post_status'    => 'publish',
			)
		);

		if ( empty( $sources ) ) {
			WP_CLI::warning( 'No feed sources found.' );
			return;
		}

		$progress = \WP_CLI\Utils\make_progress_bar( 'Fetching feeds', count( $sources ) );

		$success_count = 0;
		$error_count   = 0;

		foreach ( $sources as $source ) {
			$result = $fetcher->fetch_feed( $source->ID );

			if ( is_wp_error( $result ) ) {
				$error_count++;
				WP_CLI::warning( sprintf( 'Error fetching "%s": %s', $source->post_title, $result->get_error_message() ) );
			} else {
				$success_count++;
			}

			$progress->tick();
		}

		$progress->finish();

		WP_CLI::line( '' );
		WP_CLI::success( sprintf( 'Successfully fetched %d feeds.', $success_count ) );

		if ( $error_count > 0 ) {
			WP_CLI::warning( sprintf( '%d feeds failed to fetch.', $error_count ) );
		}

		// Get total items count.
		$total_items = wp_count_posts( Feeds_Feed_Item_CPT::POST_TYPE )->publish;
		WP_CLI::success( sprintf( 'Total feed items: %d', $total_items ) );
	}

	/**
	 * Deletes all feed items only (without refetching).
	 *
	 * ## EXAMPLES
	 *
	 *     wp feeds delete-all-items
	 *
	 * @when after_wp_load
	 */
	public function delete_all_items( $args, $assoc_args ) {
		WP_CLI::confirm( 'Are you sure you want to delete all feed items? This cannot be undone.' );

		WP_CLI::line( 'Deleting all feed items...' );
		$deleted = $this->delete_all_feed_items();
		WP_CLI::success( sprintf( 'Deleted %d feed items.', $deleted ) );
	}

	/**
	 * Fetches all feeds without deleting existing items.
	 *
	 * ## EXAMPLES
	 *
	 *     wp feeds fetch-all
	 *
	 * @when after_wp_load
	 */
	public function fetch_all( $args, $assoc_args ) {
		WP_CLI::line( 'Fetching all feeds...' );
		$fetcher = Feeds_RSS_Fetcher::get_instance();
		$fetcher->fetch_all_feeds();
		WP_CLI::success( 'All feeds fetched successfully.' );
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
}
