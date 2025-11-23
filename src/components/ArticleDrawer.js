/**
 * Article Drawer Component
 * Slide-over panel for reading feed item content
 */
import { useEffect } from '@wordpress/element';
import { Button, Icon } from '@wordpress/components';
import { close, external } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

const ArticleDrawer = ( { article, onClose } ) => {
	// Close on ESC key.
	useEffect( () => {
		const handleEsc = ( event ) => {
			if ( event.key === 'Escape' ) {
				onClose();
			}
		};
		window.addEventListener( 'keydown', handleEsc );
		return () => window.removeEventListener( 'keydown', handleEsc );
	}, [ onClose ] );

	if ( ! article ) {
		return null;
	}

	const permalink = article.meta?._feeds_item_permalink;
	const author = article.meta?._feeds_item_author;
	const thumbnailUrl = article.meta?._feeds_item_thumbnail_url;
	const pubDate = article.meta?._feeds_item_pub_date;

	return (
		<div className="feeds-article-drawer open">
			<div className="feeds-article-drawer-header">
				<h2>{ __( 'Article', 'feeds' ) }</h2>
				<div style={ { display: 'flex', gap: '10px' } }>
					{ permalink && (
						<Button
							variant="secondary"
							icon={ external }
							href={ permalink }
							target="_blank"
							rel="noopener noreferrer"
						>
							{ __( 'Open Original', 'feeds' ) }
						</Button>
					) }
					<Button
						variant="tertiary"
						icon={ close }
						onClick={ onClose }
						label={ __( 'Close', 'feeds' ) }
					/>
				</div>
			</div>

			<div className="feeds-article-drawer-content">
				{ thumbnailUrl && (
					<img
						src={ thumbnailUrl }
						alt={ article.title.rendered }
						style={ { maxWidth: '100%', marginBottom: '20px' } }
					/>
				) }

				<h1>{ article.title.rendered }</h1>

				<div className="feeds-article-drawer-meta">
					{ author && (
						<span>
							{ __( 'By', 'feeds' ) } { author }
						</span>
					) }
					{ pubDate && (
						<span>
							{ author && ' • ' }
							{ new Date( pubDate * 1000 ).toLocaleDateString() }
						</span>
					) }
				</div>

				<div
					className="feeds-article-drawer-body"
					dangerouslySetInnerHTML={ { __html: article.content.rendered } }
				/>
			</div>
		</div>
	);
};

export default ArticleDrawer;
