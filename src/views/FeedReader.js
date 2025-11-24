/**
 * Feed Reader View
 * Main reading interface using DataViews
 */
import { useState, useMemo, useEffect } from "@wordpress/element";
import { useEntityRecords } from "@wordpress/core-data";
import { useDispatch, useSelect } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";
import { DataViews } from "@wordpress/dataviews/wp";
import { __ } from "@wordpress/i18n";
import { Spinner, Button } from "@wordpress/components";
import { starEmpty } from "@wordpress/icons";
import apiFetch from "@wordpress/api-fetch";
import ArticleDrawer from "../components/ArticleDrawer";

const FeedReader = () => {
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [feedItems, setFeedItems] = useState([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [totalItems, setTotalItems] = useState(0);
  const [view, setView] = useState({
    type: "list",
    perPage: 20,
    page: 1,
    sort: {
      field: "date",
      direction: "desc",
    },
    search: "",
    filters: [],
    fields: ["feed", "date", "author"],
    titleField: "title",
    descriptionField: "excerpt",
  });

  // Fetch labels.
  const { records: labels } = useEntityRecords("taxonomy", "feeds_label", {
    per_page: -1,
  });

  // Get label IDs (only need favorite now since read is handled via meta).
  const favoriteLabelId = labels?.find(
    (label) => label.slug === "favorite"
  )?.id;

  // Fetch feed items manually with REST API.
  useEffect(() => {
    const fetchFeedItems = async () => {
      setIsLoadingItems(true);

      const filters = {};
      view.filters.forEach((filter) => {
        if (
          filter.field === "status" &&
          filter.operator === "is" &&
          filter.value === "read"
        ) {
          filters.is_read = true;
        }
        if (
          filter.field === "status" &&
          filter.operator === "is" &&
          filter.value === "unread"
        ) {
          filters.is_read = false;
        }
        if (
          filter.field === "status" &&
          filter.operator === "is" &&
          filter.value === "favorite"
        ) {
          filters.feeds_label = favoriteLabelId;
        }
      });

      const queryParams = new URLSearchParams({
        per_page: view.perPage,
        page: view.page,
        orderby: view.sort.field,
        order: view.sort.direction,
        search: view.search,
        status: "publish",
        ...filters,
      });

      try {
        const response = await apiFetch({
          path: `/wp/v2/feed_items?${queryParams.toString()}`,
          parse: false,
        });

        const items = await response.json();
        const total = parseInt(response.headers.get("X-WP-Total"), 10);

        setFeedItems(items);
        setTotalItems(total);
      } catch (error) {
        console.error("Failed to fetch feed items:", error);
      } finally {
        setIsLoadingItems(false);
      }
    };

    fetchFeedItems();
  }, [view, favoriteLabelId]);

  // Fetch feed sources.
  const { records: feedSources, isResolving: isLoadingSources } =
    useEntityRecords("postType", "feeds_source", {
      per_page: -1,
    });

  // Helper to check if item has a label.
  const hasLabel = (item, labelSlug) => {
    // Handle 'read' status via meta field.
    if (labelSlug === "read") {
      return item.meta?._feeds_item_is_read === true;
    }
    // Handle other labels via taxonomy.
    return item.feeds_label?.some((id) => {
      const label = labels?.find((l) => l.id === id);
      return label?.slug === labelSlug;
    });
  };

  // Mark item as read - update local state and server.
  const markAsRead = async (itemId, isRead = true) => {
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
      // Optionally revert the optimistic update on error.
    }
  };

  // Toggle favorite.
  const toggleFavorite = async (itemId, currentItem) => {
    const currentLabels = currentItem.feeds_label || [];
    let newLabels;

    if (favoriteLabelId) {
      if (currentLabels.includes(favoriteLabelId)) {
        // Remove favorite label.
        newLabels = currentLabels.filter((id) => id !== favoriteLabelId);
      } else {
        // Add favorite label.
        newLabels = [...currentLabels, favoriteLabelId];
      }

      editEntityRecord("postType", "feeds_item", itemId, {
        feeds_label: newLabels,
      });

      await saveEditedEntityRecord("postType", "feeds_item", itemId);
    }
  };

  // Helper function to get feed source name.
  const getFeedSourceName = (sourceId) => {
    if (!feedSources || !sourceId) return "";
    const source = feedSources.find((s) => s.id === sourceId);
    return source?.title?.rendered || "";
  };

  // Define fields for DataViews.
  const fields = [
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
            <strong>{item.title.rendered}</strong>
          )}
        </>
      ),
      enableHiding: false,
      enableSorting: true,
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
      enableSorting: true,
    },
    {
      id: "feed",
      type: "text",
      label: __("Feed", "feeds"),
      getValue: (item) => getFeedSourceName(item.meta?._feeds_item_source_id),
      render: ({ item }) => {
        const feedName = getFeedSourceName(item.meta?._feeds_item_source_id);
        return feedName || <span style={{ color: "#999" }}>—</span>;
      },
      enableSorting: false,
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
    },
  ];

  // Handle closing the article drawer.
  const handleCloseArticle = () => {
    if (selectedArticle) {
      // Mark as read when closing.
      markAsRead(selectedArticle.id, true);
    }
    setSelectedArticle(null);
  };

  // Handle toggling favorite for the selected article.
  const handleToggleFavoriteArticle = async () => {
    if (!selectedArticle || !favoriteLabelId) return;

    const currentLabels = selectedArticle.feeds_label || [];
    let newLabels;

    if (currentLabels.includes(favoriteLabelId)) {
      // Remove favorite label.
      newLabels = currentLabels.filter((id) => id !== favoriteLabelId);
    } else {
      // Add favorite label.
      newLabels = [...currentLabels, favoriteLabelId];
    }

    // Optimistically update the selected article state immediately.
    setSelectedArticle({
      ...selectedArticle,
      feeds_label: newLabels,
    });

    // Then persist to the server.
    editEntityRecord("postType", "feeds_item", selectedArticle.id, {
      feeds_label: newLabels,
    });

    await saveEditedEntityRecord("postType", "feeds_item", selectedArticle.id);
  };

  // Define actions.
  const actions = [
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
          markAsRead(item.id, true);
        });
      },
    },
    {
      id: "mark-unread",
      label: __("Mark as Unread", "feeds"),
      callback(items) {
        items.forEach((item) => {
          markAsRead(item.id, false);
        });
      },
    },
    {
      id: "toggle-favorite",
      label: __("Toggle Favorite", "feeds"),
      icon: starEmpty,
      callback(items) {
        items.forEach((item) => {
          toggleFavorite(item.id, item);
        });
      },
    },
  ];

  if (isLoadingItems || isLoadingSources) {
    return <Spinner />;
  }

  return (
    <div className="feeds-reader-container">
      <DataViews
        data={feedItems || []}
        fields={fields}
        view={view}
        onChangeView={setView}
        actions={actions}
        paginationInfo={{
          totalItems: totalItems || 0,
          totalPages: Math.ceil((totalItems || 0) / view.perPage),
        }}
        defaultLayouts={{
          list: {},
          table: {},
        }}
      />

      {selectedArticle && (
        <ArticleDrawer
          article={selectedArticle}
          onClose={handleCloseArticle}
          onToggleFavorite={handleToggleFavoriteArticle}
          isFavorite={hasLabel(selectedArticle, "favorite")}
        />
      )}
    </div>
  );
};

export default FeedReader;
