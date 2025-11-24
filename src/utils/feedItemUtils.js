/**
 * Shared utilities and configurations for feed item views
 */
import { __ } from "@wordpress/i18n";
import { starEmpty } from "@wordpress/icons";
import apiFetch from "@wordpress/api-fetch";

/**
 * Helper to check if item has a label
 */
export const hasLabel = (item, labelSlug) => {
  // Handle 'read' status via meta field.
  if (labelSlug === "read") {
    return item.meta?._feeds_item_is_read === true;
  }
  // Handle 'favorite' status via meta field.
  if (labelSlug === "favorite") {
    return item.meta?._feeds_item_is_favorite === true;
  }
  return false;
};

/**
 * Mark item as read - update local state and server
 */
export const markAsRead = async (
  itemId,
  isRead,
  setFeedItems,
  setSelectedArticle,
  selectedArticle
) => {
  // Optimistically update local state immediately for instant UI feedback.
  setFeedItems((prevItems) =>
    prevItems.map((item) =>
      item.id === itemId
        ? {
            ...item,
            meta: {
              ...item.meta,
              _feeds_item_is_read: isRead,
            },
          }
        : item
    )
  );

  // Update selected article if it's the one being modified.
  if (selectedArticle?.id === itemId) {
    setSelectedArticle((prev) => ({
      ...prev,
      meta: {
        ...prev.meta,
        _feeds_item_is_read: isRead,
      },
    }));
  }

  // Save to server in the background.
  try {
    await apiFetch({
      path: `/wp/v2/feed_items/${itemId}`,
      method: "POST",
      data: {
        meta: {
          _feeds_item_is_read: isRead,
        },
      },
    });
  } catch (error) {
    console.error("Failed to mark item as read:", error);
  }
};

/**
 * Toggle favorite status for an item
 */
export const toggleFavorite = async (
  itemId,
  currentItem,
  setFeedItems,
  setSelectedArticle,
  selectedArticle
) => {
  const isFavorite = currentItem.meta?._feeds_item_is_favorite === true;
  const newFavoriteStatus = !isFavorite;

  // Optimistically update local state immediately for instant UI feedback.
  setFeedItems((prevItems) =>
    prevItems.map((item) =>
      item.id === itemId
        ? {
            ...item,
            meta: {
              ...item.meta,
              _feeds_item_is_favorite: newFavoriteStatus,
            },
          }
        : item
    )
  );

  // Update selected article if it's the one being modified.
  if (selectedArticle?.id === itemId) {
    setSelectedArticle((prev) => ({
      ...prev,
      meta: {
        ...prev.meta,
        _feeds_item_is_favorite: newFavoriteStatus,
      },
    }));
  }

  // Save to server in the background.
  try {
    await apiFetch({
      path: `/wp/v2/feed_items/${itemId}`,
      method: "POST",
      data: {
        meta: {
          _feeds_item_is_favorite: newFavoriteStatus,
        },
      },
    });
  } catch (error) {
    console.error("Failed to toggle favorite:", error);
  }
};

/**
 * Get feed source name by ID
 */
export const getFeedSourceName = (sourceId, feedSources) => {
  if (!feedSources || !sourceId) return "";
  const source = feedSources.find((s) => s.id === sourceId);
  return source?.title?.rendered || "";
};

/**
 * Define DataViews fields configuration
 */
export const getFields = (feedSources) => [
  {
    id: "title",
    type: "text",
    label: __("Title", "feeds"),
    getValue: (item) => item.title.rendered,
    render: ({ item }) => (
      <>
        {hasLabel(item, "read") ? (
          <>
            {item.title.rendered}
            <span style={{ marginLeft: "8px", color: "#666" }}>✓</span>
          </>
        ) : (
          <>{item.title.rendered}</>
        )}
      </>
    ),
    enableHiding: false,
    enableSorting: true,
    filterBy: false,
  },
  {
    id: "date",
    type: "datetime",
    label: __("Date", "feeds"),
    getValue: (item) => item.date,
    render: ({ item }) => {
      const date = new Date(item.date);
      return date.toLocaleDateString();
    },
    enableSorting: true,
    filterBy: false,
  },
  {
    id: "excerpt",
    type: "text",
    label: __("Excerpt", "feeds"),
    getValue: (item) => item.excerpt.rendered,
    render: ({ item }) => {
      return (
        <div dangerouslySetInnerHTML={{ __html: item.excerpt.rendered }} />
      );
    },
    enableSorting: false,
    filterBy: false,
  },
  {
    id: "feed",
    type: "text",
    label: __("Feed", "feeds"),
    getValue: (item) =>
      getFeedSourceName(item.meta?._feeds_item_source_id, feedSources),
    render: ({ item }) => {
      const feedName = getFeedSourceName(
        item.meta?._feeds_item_source_id,
        feedSources
      );
      return feedName || <span style={{ color: "#999" }}>—</span>;
    },
    enableSorting: false,
    filterBy: false,
  },
  {
    id: "author",
    type: "text",
    label: __("Author", "feeds"),
    getValue: (item) => item.meta?._feeds_item_author || "",
    render: ({ item }) => {
      const author = item.meta?._feeds_item_author;
      return author || <span style={{ color: "#999" }}>—</span>;
    },
    enableSorting: false,
    filterBy: false,
  },
];

/**
 * Define DataViews actions
 */
export const getActions = (
  setSelectedArticle,
  markAsReadCallback,
  toggleFavoriteCallback
) => [
  {
    id: "view",
    label: __("View", "feeds"),
    isPrimary: true,
    callback(items) {
      if (items.length === 1) {
        setSelectedArticle(items[0]);
      }
    },
  },
  {
    id: "mark-read",
    label: __("Mark as Read", "feeds"),
    callback(items) {
      items.forEach((item) => {
        markAsReadCallback(item.id, true);
      });
    },
  },
  {
    id: "mark-unread",
    label: __("Mark as Unread", "feeds"),
    callback(items) {
      items.forEach((item) => {
        markAsReadCallback(item.id, false);
      });
    },
  },
  {
    id: "toggle-favorite",
    label: __("Toggle Favorite", "feeds"),
    icon: starEmpty,
    callback(items) {
      items.forEach((item) => {
        toggleFavoriteCallback(item.id, item);
      });
    },
  },
];
