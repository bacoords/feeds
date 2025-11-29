# Feeds - WordPress RSS Reader Plugin (beta)

A self-hosted RSS reader living natively inside the WordPress Admin Dashboard. It aggregates content from external feeds into Custom Post Types and provides a modern React-based reading interface using @wordpress/dataviews.

Download a zip of the latest release from the [Releases page](https://github.com/bacoords/feeds/releases).

Try it out on WordPress Playground: [Playground](https://playground.wordpress.net/?blueprint-url=https://github.com/bacoords/feeds/blob/main/assets/blueprints/blueprint.json)

## Features

- **Feed Management**: Add, delete, refresh, and manage RSS feed subscriptions with status monitoring
- **OPML Import**: Import feed subscriptions from OPML files with automatic category organization
- **Smart Reading Interface**: Modern React-based split-pane UI with DataViews (table & list views)
- **Auto-Sync**: Automatic feed fetching with per-feed refresh intervals (powered by Action Scheduler)
- **Read/Unread Tracking**: Articles automatically marked as read when closed
- **Favorites**: Star important articles - favorites are preserved when closing articles
- **Thumbnail Support**: Automatic extraction of article images from multiple sources (media:thumbnail, enclosures, content)
- **Feed Status Monitoring**: Filter feeds by success/error status to identify problematic sources

## Development

This project uses `@wordpress/scripts` for the build process.

### Setup

```bash
composer install
npm install
npm run build
```

### Build Commands

- `npm run build` - Production build
- `npm run start` - Development build with watch mode

## Architecture

### Custom Post Types

- **feeds_source**: RSS feed subscriptions with metadata (URL, last fetched timestamp, error messages)
- **feeds_item**: Individual feed articles with metadata (source ID, permalink, author, thumbnail URL, publication date)

### Post Statuses

The plugin uses custom post statuses for efficient filtering without meta queries:

**Feed Items:**
- `publish` - Unread articles (default)
- `trash` - Articles marked as read get moved to trash
- `favorite` - Favorited articles get saved with this status

**Feed Sources:**
- `publish` - Successfully fetched feeds
- `pending` - Feeds with fetch errors

### Taxonomies

- **feeds_category**: Organize feeds and items by category (supports OPML import hierarchy) **Note: This is not exposed in the UI yet.**

## API Endpoints

The plugin exposes the following REST API endpoints:

- `POST /wp-json/feeds/v1/refresh/{id}` - Manually refresh a single feed source
- `POST /wp-json/feeds/v1/import-opml` - Import OPML file with feed subscriptions

## Filters & Hooks
The plugin provides the following filters for customization:
- `feeds_excerpt_char_limit` - Filter to change the excerpt character limit (default: 300)
- `feeds_import_max_age_days` - Filter to change the maximum age of items to import when adding a feed (default: 7 days)

Examples:
```php
// Increase excerpt length
add_filter( 'feeds_excerpt_char_limit', function() {
    return 500;
} );

// Only import items from the last 14 days
add_filter( 'feeds_import_max_age_days', function() {
    return 14;
} );
```

## WP-CLI Development Commands

The plugin includes WP-CLI commands for development and testing:

* `wp feeds sources fetch` - Fetch all feeds without deleting
* `wp feeds sources delete` - Deletes all feed sources and all feed items (complete reset).
* `wp feeds items delete` - Deletes all feed items and keeps sources.

## License

GPL v2 or later

## Support

For issues and feature requests, please open an issue on the [GitHub repository](https://github.com/bacoords/feeds).
