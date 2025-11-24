# Feeds - WordPress RSS Reader Plugin (beta)

A self-hosted RSS reader living natively inside the WordPress Admin Dashboard. It aggregates content from external feeds into Custom Post Types and provides a modern React-based reading interface using @wordpress/dataviews.

## Features

- **Feed Management**: Add, delete, and manage RSS feed subscriptions
- **Smart Reading Interface**: Modern React-based UI with DataViews
- **Auto-Sync**: Hourly automatic feed fetching
- **Read/Unread Tracking**: Mark articles as read or unread
- **Favorites**: Star important articles to exclude them from auto-pruning
- **Auto-Pruning**: Automatically delete old items (default: 30 days) while preserving favorites
- **Categories**: Organize feeds with custom categories
- **Full-Text Reading**: Read articles directly in WordPress with a beautiful drawer interface

## Development

This project uses `@wordpress/scripts` for the build process.

## API Endpoints

The plugin exposes the following REST API endpoints:

- `POST /wp-json/feeds/v1/refresh/{id}` - Manually refresh a feed

## Filters & Hooks

- `feeds_retention_days` - Filter to change the auto-pruning retention period (default: 30 days)

Example:
```php
add_filter( 'feeds_retention_days', function() {
    return 90; // Keep items for 90 days
} );
```

## Background Jobs

The plugin uses Action Scheduler to schedule:

- **Hourly**: Fetch all feeds (`feeds_fetch_all`)
- **Daily**: Prune old items (`feeds_prune_items`)


## License

GPL v2 or later

## Support

For issues and feature requests, please contact the plugin developer.
