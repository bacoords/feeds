/**
 * Feed Reader View
 * Main reading interface using DataViews
 */
import { useState } from "@wordpress/element";
import { useEntityRecords } from "@wordpress/core-data";
import { useDispatch } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";
import { DataViews } from "@wordpress/dataviews/wp";
import { __ } from "@wordpress/i18n";
import { Spinner } from "@wordpress/components";
import { starEmpty } from "@wordpress/icons";
import ArticleDrawer from "../components/ArticleDrawer";

const FeedReader = () => {
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [view, setView] = useState({
    type: "table",
    perPage: 20,
    page: 1,
    sort: {
      field: "date",
      direction: "desc",
    },
    search: "",
    filters: [],
    fields: ["title", "feed", "date", "author"],
  });

  // Get entity editing functions.
  const { editEntityRecord, saveEditedEntityRecord } = useDispatch(coreStore);

  // Fetch feed items.
  const { records: feedItems, isResolving: isLoadingItems } = useEntityRecords(
    "postType",
    "feeds_item",
    {
      per_page: view.perPage,
      page: view.page,
      orderby: view.sort.field,
      order: view.sort.direction,
      search: view.search,
      status: "publish",
    }
  );

  // Fetch feed sources.
  const { records: feedSources, isResolving: isLoadingSources } =
    useEntityRecords("postType", "feeds_source", {
      per_page: -1,
    });

  // Fetch labels.
  const { records: labels } = useEntityRecords("taxonomy", "feeds_label", {
    per_page: -1,
  });

  // Get label IDs.
  const readLabelId = labels?.find((label) => label.slug === "read")?.id;
  const favoriteLabelId = labels?.find(
    (label) => label.slug === "favorite"
  )?.id;

  // Helper to check if item has a label.
  const hasLabel = (item, labelSlug) => {
    return item.feeds_label?.some((id) => {
      const label = labels?.find((l) => l.id === id);
      return label?.slug === labelSlug;
    });
  };

  // Mark item as read.
  const markAsRead = async (itemId, isRead = true, currentItem) => {
    const currentLabels = currentItem.feeds_label || [];
    let newLabels;

    if (isRead && readLabelId) {
      // Add read label if not present.
      newLabels = currentLabels.includes(readLabelId)
        ? currentLabels
        : [...currentLabels, readLabelId];
    } else if (!isRead && readLabelId) {
      // Remove read label.
      newLabels = currentLabels.filter((id) => id !== readLabelId);
    } else {
      newLabels = currentLabels;
    }

    editEntityRecord("postType", "feeds_item", itemId, {
      feeds_label: newLabels,
    });

    await saveEditedEntityRecord("postType", "feeds_item", itemId);
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
        <div>
          {hasLabel(item, "read") ? (
            <>
              {item.title.rendered}
              <span style={{ marginLeft: "8px", color: "#666" }}>✓</span>
            </>
          ) : (
            <strong>{item.title.rendered}</strong>
          )}
        </div>
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
    {
      id: "status",
      type: "enumeration",
      label: __("Status", "feeds"),
      elements: [
        { value: "read", label: __("Read", "feeds") },
        { value: "unread", label: __("Unread", "feeds") },
        { value: "all", label: __("All", "feeds") },
      ],
      getValue: (item) => (hasLabel(item, "read") ? "read" : "unread"),
      filterBy: {
        operators: ["is", "isNot"],
      },
      render: ({ item }) => {
        return hasLabel(item, "read") ? "read" : "unread";
      },
      enableSorting: false,
    },
  ];

  // Define actions.
  const actions = [
    {
      id: "view",
      label: __("View", "feeds"),
      isPrimary: true,
      callback(items) {
        if (items.length === 1) {
          setSelectedArticle(items[0]);
          markAsRead(items[0].id, true, items[0]);
        }
      },
    },
    {
      id: "mark-read",
      label: __("Mark as Read", "feeds"),
      callback(items) {
        items.forEach((item) => {
          markAsRead(item.id, true, item);
        });
      },
    },
    {
      id: "mark-unread",
      label: __("Mark as Unread", "feeds"),
      callback(items) {
        items.forEach((item) => {
          markAsRead(item.id, false, item);
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
          totalItems: feedItems?.length || 0,
          totalPages: Math.ceil((feedItems?.length || 0) / view.perPage),
        }}
        defaultLayouts={{
          table: {},
        }}
      />

      {selectedArticle && (
        <ArticleDrawer
          article={selectedArticle}
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </div>
  );
};

export default FeedReader;
