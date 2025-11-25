/**
 * Article Drawer Component
 * Slide-over panel for reading feed item content
 */
import { useEffect } from "@wordpress/element";
import { Button, Icon } from "@wordpress/components";
import { close, external, starFilled, starEmpty } from "@wordpress/icons";
import { __ } from "@wordpress/i18n";
import { decodeEntities } from "@wordpress/html-entities";

const ArticleDrawer = ({ article, onClose, onToggleFavorite, isFavorite }) => {
  // Close on ESC key.
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!article) {
    return null;
  }

  const permalink = article.meta?._feeds_item_permalink;
  const author = article.meta?._feeds_item_author;
  const thumbnailUrl = article.meta?._feeds_item_thumbnail_url;
  const pubDate = article.meta?._feeds_item_pub_date;

  return (
    <div className="feeds-article-drawer">
      <div className="feeds-article-drawer-header">
        <div className="feeds-article-drawer-actions">
          <Button
            icon={isFavorite ? starFilled : starEmpty}
            onClick={onToggleFavorite}
            label={
              isFavorite ? __("Unfavorite", "feeds") : __("Favorite", "feeds")
            }
            showTooltip
            style={isFavorite ? { color: "#e6c200" } : {}}
          />
          {permalink && (
            <Button
              icon={external}
              href={permalink}
              target="_blank"
              rel="noopener noreferrer"
              label={__("Open Original", "feeds")}
              showTooltip
            />
          )}
          <Button
            icon={close}
            onClick={onClose}
            label={__("Close", "feeds")}
            showTooltip
          />
        </div>
      </div>

      <div className="feeds-article-drawer-content">
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt={decodeEntities(article.title.rendered)}
            style={{ maxWidth: "100%", marginBottom: "20px" }}
          />
        )}

        <h1>{decodeEntities(article.title.rendered)}</h1>

        <div className="feeds-article-drawer-meta">
          {author && (
            <span>
              {__("By", "feeds")} {author}
            </span>
          )}
          {pubDate && (
            <span>
              {author && " • "}
              {new Date(pubDate * 1000).toLocaleDateString()}
            </span>
          )}
        </div>

        <div
          className="feeds-article-drawer-body"
          dangerouslySetInnerHTML={{ __html: article.content.rendered }}
        />
      </div>
    </div>
  );
};

export default ArticleDrawer;
