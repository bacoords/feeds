/**
 * Shared utilities and configurations for feed item views
 */
import { __ } from "@wordpress/i18n";
import { starEmpty } from "@wordpress/icons";
import apiFetch from "@wordpress/api-fetch";
import { decodeEntities } from "@wordpress/html-entities";

/**
 * Helper to check if item has a label
 */
export const hasLabel = (item, labelSlug) => {
  // Handle 'read' status via post_status.
  if (labelSlug === "read") {
    return item.status === "read";
  }
  // Handle 'favorite' status via post_status.
  if (labelSlug === "favorite") {
    return item.status === "favorite";
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
  const newStatus = isRead ? "read" : "publish";

  // Optimistically update local state immediately for instant UI feedback.
  setFeedItems((prevItems) =>
    prevItems.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: newStatus,
          }
        : item
    )
  );

  // Update selected article if it's the one being modified.
  if (selectedArticle?.id === itemId) {
    setSelectedArticle((prev) => ({
      ...prev,
      status: newStatus,
    }));
  }

  // Save to server in the background.
  try {
    await apiFetch({
      path: `/wp/v2/feed_items/${itemId}`,
      method: "POST",
      data: {
        status: newStatus,
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
  const isFavorite = currentItem.status === "favorite";
  const newStatus = isFavorite ? "publish" : "favorite";

  // Optimistically update local state immediately for instant UI feedback.
  setFeedItems((prevItems) =>
    prevItems.map((item) =>
      item.id === itemId
        ? {
            ...item,
            status: newStatus,
          }
        : item
    )
  );

  // Update selected article if it's the one being modified.
  if (selectedArticle?.id === itemId) {
    setSelectedArticle((prev) => ({
      ...prev,
      status: newStatus,
    }));
  }

  // Save to server in the background.
  try {
    await apiFetch({
      path: `/wp/v2/feed_items/${itemId}`,
      method: "POST",
      data: {
        status: newStatus,
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
        <>{decodeEntities(item.title.rendered)}</>
        {hasLabel(item, "read") && (
          <span style={{ marginInline: "8px", color: "#666" }}>✓</span>
        )}
        {hasLabel(item, "favorite") && (
          <span style={{ marginInline: "8px", color: "#e66771" }}>♥</span>
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
      return <>{decodeEntities(item.excerpt.rendered)}</>;
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
      return (
        decodeEntities(feedName) || <span style={{ color: "#999" }}>—</span>
      );
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
      return decodeEntities(author) || <span style={{ color: "#999" }}>—</span>;
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
