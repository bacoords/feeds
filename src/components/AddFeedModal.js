/**
 * Add Feed Modal Component
 * Modal form to add a new feed subscription
 */
import { useState } from '@wordpress/element';
import {
	Modal,
	Button,
	TextControl,
	Notice,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const AddFeedModal = ( { onClose } ) => {
	const [ feedUrl, setFeedUrl ] = useState( '' );
	const [ feedName, setFeedName ] = useState( '' );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState( null );

	const handleSubmit = async () => {
		if ( ! feedUrl ) {
			setError( __( 'Please enter a feed URL', 'feeds' ) );
			return;
		}

		setIsLoading( true );
		setError( null );

		try {
			// Create the feed source post.
			const response = await apiFetch( {
				path: '/wp/v2/feeds_source',
				method: 'POST',
				data: {
					title: feedName || feedUrl,
					status: 'publish',
					meta: {
						_feeds_source_url: feedUrl,
					},
				},
			} );

			// Trigger an immediate fetch.
			await apiFetch( {
				path: `/feeds/v1/refresh/${ response.id }`,
				method: 'POST',
			} );

			// Close the modal.
			onClose();
		} catch ( err ) {
			console.error( 'Error adding feed:', err );
			setError(
				err.message || __( 'Failed to add feed. Please check the URL and try again.', 'feeds' )
			);
		} finally {
			setIsLoading( false );
		}
	};

	return (
		<Modal
			title={ __( 'Add New Feed', 'feeds' ) }
			onRequestClose={ onClose }
			className="feeds-add-feed-modal"
		>
			<div>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }

				<TextControl
					label={ __( 'Feed Name (Optional)', 'feeds' ) }
					value={ feedName }
					onChange={ setFeedName }
					placeholder={ __( 'e.g., Smashing Magazine', 'feeds' ) }
					help={ __( 'Leave blank to use the feed URL as the name', 'feeds' ) }
				/>

				<TextControl
					label={ __( 'Feed URL', 'feeds' ) }
					value={ feedUrl }
					onChange={ setFeedUrl }
					placeholder={ __( 'https://example.com/feed.xml', 'feeds' ) }
					type="url"
					required
				/>

				<div style={ { display: 'flex', gap: '10px', marginTop: '20px' } }>
					<Button
						variant="primary"
						onClick={ handleSubmit }
						isBusy={ isLoading }
						disabled={ isLoading }
					>
						{ __( 'Add Feed', 'feeds' ) }
					</Button>
					<Button
						variant="secondary"
						onClick={ onClose }
						disabled={ isLoading }
					>
						{ __( 'Cancel', 'feeds' ) }
					</Button>
				</div>
			</div>
		</Modal>
	);
};

export default AddFeedModal;
