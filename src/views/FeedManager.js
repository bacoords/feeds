/**
 * Feed Manager View
 * Manage feed sources using DataViews
 */
import { useState, useMemo } from "@wordpress/element";
import { useEntityRecords } from "@wordpress/core-data";
import { useDispatch } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";
import { DataViews } from "@wordpress/dataviews/wp";
import { __ } from "@wordpress/i18n";
import { Button, Spinner, Flex } from "@wordpress/components";
import { plus, trash, update, upload } from "@wordpress/icons";
import apiFetch from "@wordpress/api-fetch";
import AddFeedModal from "../components/AddFeedModal";
import ImportOPMLModal from "../components/ImportOPMLModal";
import { decodeEntities } from "@wordpress/html-entities";

const FeedManager = () => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [view, setView] = useState({
    type: "list",
    perPage: 20,
    page: 1,
    sort: {
      field: "title",
      direction: "asc",
    },
    search: "",
    filters: [],
    fields: ["status"],
    titleField: "title",
    descriptionField: "url",
  });

  // Memoize query parameters.
  const queryArgs = useMemo(() => {
    const args = {
      per_page: view.perPage,
      page: view.page,
      orderby: view.sort.field,
      order: view.sort.direction,
      search: view.search,
      status: "publish",
    };

    // Apply status filter if it exists.
    const statusFilter = view.filters.find((filter) => filter.field === "status");
    if (statusFilter && statusFilter.value) {
      args.meta_key = "_feeds_fetch_status";
      args.meta_value = statusFilter.value;
    }

    return args;
  }, [view.perPage, view.page, view.sort.field, view.sort.direction, view.search, view.filters]);

  // Fetch feed sources.
  const {
    records: feedSources,
    isResolving: isLoading,
    totalItems,
  } = useEntityRecords("postType", "feeds_source", queryArgs);

  // Get datastore dispatch functions.
  const { deleteEntityRecord, invalidateResolution } = useDispatch(coreStore);

  // Refresh feed sources list.
  const refreshFeedSources = () => {
    invalidateResolution("getEntityRecords", ["postType", "feeds_source", queryArgs]);
  };

  // Refresh a feed.
  const refreshFeed = async (sourceId) => {
    try {
      await apiFetch({
        path: `/feeds/v1/refresh/${sourceId}`,
        method: "POST",
      });
      // Optionally show a success message.
      alert(__("Feed refresh started", "feeds"));
    } catch (error) {
      console.error("Error refreshing feed:", error);
      alert(__("Failed to refresh feed", "feeds"));
    }
  };

  // Delete a feed.
  const deleteFeed = async (sourceId) => {
    if (!confirm(__("Are you sure you want to delete this feed?", "feeds"))) {
      return;
    }

    try {
      await deleteEntityRecord(
        "postType",
        "feeds_source",
        sourceId,
        {},
        { throwOnError: true }
      );
    } catch (error) {
      console.error("Error deleting feed:", error);
      alert(__("Failed to delete feed", "feeds"));
    }
  };

  // Define fields for DataViews.
  const fields = [
    {
      id: "title",
      type: "text",
      label: __("Feed Name", "feeds"),
      getValue: (item) => item.title.rendered,
      render: ({ item }) => <>{decodeEntities(item.title.rendered)}</>,
      enableHiding: false,
      enableSorting: true,
      filterBy: false,
    },
    {
      id: "url",
      type: "text",
      label: __("Feed URL", "feeds"),
      getValue: (item) => item.meta._feeds_source_url || "",
      render: ({ item }) => (
        <a
          href={item.meta._feeds_source_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {item.meta._feeds_source_url}
        </a>
      ),
      enableSorting: false,
      filterBy: false,
    },
    {
      id: "status",
      type: "enumeration",
      label: __("Status", "feeds"),
      getValue: (item) => item.meta._feeds_fetch_status || "unknown",
      render: ({ item }) => {
        const status = item.meta._feeds_fetch_status;
        const color =
          status === "success" ? "green" : status === "error" ? "red" : "gray";
        return (
          <span style={{ color }}>
            {status === "success"
              ? "✓ Active"
              : status === "error"
              ? "✗ Error"
              : "Unknown"}
          </span>
        );
      },
      elements: [
        { value: "success", label: __("Active", "feeds") },
        { value: "error", label: __("Error", "feeds") },
      ],
      enableSorting: false,
    },
    {
      id: "last_fetched",
      type: "integer",
      label: __("Last Fetched", "feeds"),
      getValue: (item) => item.meta._feeds_last_fetched || 0,
      render: ({ item }) => {
        const timestamp = item.meta._feeds_last_fetched;
        if (!timestamp) {
          return __("Never", "feeds");
        }
        const date = new Date(timestamp * 1000);
        return date.toLocaleString();
      },
      enableSorting: false,
      filterBy: false,
    },
  ];

  // Define actions.
  const actions = [
    {
      id: "refresh",
      label: __("Refresh Now", "feeds"),
      icon: update,
      callback(items) {
        items.forEach((item) => {
          refreshFeed(item.id);
        });
      },
    },
    {
      id: "delete",
      label: __("Delete", "feeds"),
      icon: trash,
      isDestructive: true,
      callback(items) {
        items.forEach((item) => {
          deleteFeed(item.id);
        });
      },
    },
  ];

  const Header = () => (
    <div className="feeds-manager-header">
      <Flex justify="flex-end">
        <Button
          variant="primary"
          icon={plus}
          onClick={() => setIsAddModalOpen(true)}
        >
          {__("Add New Feed", "feeds")}
        </Button>
        <Button
          variant="secondary"
          icon={upload}
          onClick={() => setIsImportModalOpen(true)}
        >
          {__("Import OPML", "feeds")}
        </Button>
      </Flex>
    </div>
  );

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <div className="feeds-manager-container">
      <DataViews
        data={feedSources || []}
        fields={fields}
        view={view}
        onChangeView={setView}
        actions={actions}
        paginationInfo={{
          totalItems: totalItems,
          totalPages: Math.ceil((totalItems || 0) / view.perPage),
        }}
        header={<Header />}
        defaultLayouts={{
          table: {},
          list: {},
        }}
      />

      {isAddModalOpen && (
        <AddFeedModal onClose={() => setIsAddModalOpen(false)} />
      )}

      {isImportModalOpen && (
        <ImportOPMLModal
          onClose={() => setIsImportModalOpen(false)}
          onImportComplete={refreshFeedSources}
        />
      )}
    </div>
  );
};

export default FeedManager;
