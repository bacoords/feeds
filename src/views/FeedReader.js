/**
 * Feed Reader View
 * Main reading interface using DataViews
 */
import { useState, useEffect } from "@wordpress/element";
import { useEntityRecords } from "@wordpress/core-data";
import { useDispatch } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";
import { DataViews } from "@wordpress/dataviews/wp";
import { Spinner } from "@wordpress/components";
import apiFetch from "@wordpress/api-fetch";
import ArticleDrawer from "../components/ArticleDrawer";
import {
  hasLabel,
  markAsRead,
  toggleFavorite,
  getFields,
  getActions,
} from "../utils/feedItemUtils";

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
          filters.is_favorite = true;
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
  }, [view]);

  // Fetch feed sources.
  const { records: feedSources, isResolving: isLoadingSources } =
    useEntityRecords("postType", "feeds_source", {
      per_page: -1,
    });

  // Wrapper for markAsRead with current state.
  const markAsReadCallback = (itemId, isRead) => {
    markAsRead(itemId, isRead, setFeedItems, setSelectedArticle, selectedArticle);
  };

  // Wrapper for toggleFavorite with current dependencies.
  const toggleFavoriteCallback = (itemId, currentItem) => {
    toggleFavorite(itemId, currentItem, setFeedItems, setSelectedArticle, selectedArticle);
  };

  // Get fields and actions.
  const fields = getFields(feedSources);
  const actions = getActions(setSelectedArticle, markAsReadCallback, toggleFavoriteCallback);

  // Handle closing the article drawer.
  const handleCloseArticle = () => {
    if (selectedArticle) {
      // Mark as read when closing.
      markAsReadCallback(selectedArticle.id, true);
    }
    setSelectedArticle(null);
  };

  // Handle toggling favorite for the selected article.
  const handleToggleFavoriteArticle = () => {
    if (!selectedArticle) return;
    toggleFavoriteCallback(selectedArticle.id, selectedArticle);
  };

  if (isLoadingItems || isLoadingSources) {
    return <Spinner />;
  }

  return (
    <div className="feeds-reader-container">
      <div className="feeds-reader-list-pane">
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
      </div>

      <div className={`feeds-reader-article-pane ${selectedArticle ? "has-article" : ""}`}>
        {selectedArticle ? (
          <ArticleDrawer
            article={selectedArticle}
            onClose={handleCloseArticle}
            onToggleFavorite={handleToggleFavoriteArticle}
            isFavorite={hasLabel(selectedArticle, "favorite")}
          />
        ) : (
          <div style={{ textAlign: "center", padding: "40px" }}>
            Select an article to read
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedReader;
