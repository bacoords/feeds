/**
 * Feed Reader View
 * Main reading interface using DataViews
 */
import { useState } from "@wordpress/element";
import { useEntityRecords } from "@wordpress/core-data";
import { DataViews } from "@wordpress/dataviews/wp";
import { __ } from "@wordpress/i18n";
import { Spinner, Panel, PanelBody } from "@wordpress/components";
import { starEmpty } from "@wordpress/icons";
import apiFetch from "@wordpress/api-fetch";
import ArticleDrawer from "../components/ArticleDrawer";

const FeedReader = () => {
  const [selectedCategory, setSelectedCategory] = useState(null);
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

  // Fetch categories.
  const { records: categories, isResolving: isLoadingCategories } =
    useEntityRecords("taxonomy", "feeds_category", {
      per_page: -1,
    });

  // Fetch feed sources.
  const { records: feedSources, isResolving: isLoadingSources } =
    useEntityRecords("postType", "feeds_source", {
      per_page: -1,
    });

  // Mark item as read.
  const markAsRead = async (itemId, isRead = true) => {
    try {
      await apiFetch({
        path: `/wp/v2/feeds_item/${itemId}`,
        method: "POST",
        data: {
          meta: {
            _feeds_item_is_read: isRead,
          },
        },
      });
    } catch (error) {
      console.error("Error marking as read:", error);
    }
  };

  // Toggle favorite.
  const toggleFavorite = async (itemId, isFavorite) => {
    try {
      await apiFetch({
        path: `/wp/v2/feeds_item/${itemId}`,
        method: "POST",
        data: {
          meta: {
            _feeds_item_is_favorite: !isFavorite,
          },
        },
      });
    } catch (error) {
      console.error("Error toggling favorite:", error);
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
          <strong>{item.title.rendered}</strong>
          {item.meta._feeds_item_is_read && (
            <span style={{ marginLeft: "8px", color: "#666" }}>✓</span>
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
      enableSorting: false,
    },
    {
      id: "author",
      type: "text",
      label: __("Author", "feeds"),
      getValue: (item) => item.meta?._feeds_item_author || "",
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
          markAsRead(items[0].id, true);
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
          toggleFavorite(item.id, item.meta._feeds_item_is_favorite);
        });
      },
    },
  ];

  if (isLoadingItems || isLoadingCategories || isLoadingSources) {
    return <Spinner />;
  }

  return (
    <div className="feeds-reader-container">
      <div className="feeds-sidebar">
        <Panel>
          <PanelBody title={__("Categories", "feeds")} initialOpen={true}>
            <ul className="feeds-category-list">
              <li
                className={`feeds-category-item ${
                  selectedCategory === null ? "active" : ""
                }`}
                onClick={() => setSelectedCategory(null)}
              >
                {__("All Items", "feeds")}
              </li>
              {categories?.map((category) => (
                <li
                  key={category.id}
                  className={`feeds-category-item ${
                    selectedCategory === category.id ? "active" : ""
                  }`}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.name}
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      </div>

      <div className="feeds-main-content">
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
      </div>

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
