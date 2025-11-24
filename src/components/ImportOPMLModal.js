/**
 * Import OPML Modal Component
 * Modal form to import feeds from an OPML file
 */
import { useState } from '@wordpress/element';
import {
	Modal,
	Button,
	FormFileUpload,
	Notice,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const ImportOPMLModal = ( { onClose, onImportComplete } ) => {
	const [ selectedFile, setSelectedFile ] = useState( null );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ result, setResult ] = useState( null );

	const handleFileChange = ( event ) => {
		const file = event.target.files[0];
		if ( file ) {
			setSelectedFile( file );
			setError( null );
			setResult( null );
		}
	};

	const handleSubmit = async () => {
		if ( ! selectedFile ) {
			setError( __( 'Please select an OPML file', 'feeds' ) );
			return;
		}

		setIsLoading( true );
		setError( null );
		setResult( null );

		try {
			const formData = new FormData();
			formData.append( 'file', selectedFile );

			const response = await apiFetch( {
				path: '/feeds/v1/import-opml',
				method: 'POST',
				body: formData,
				headers: {
					// Don't set Content-Type, let the browser set it with boundary
				},
			} );

			setResult( response );

			// Notify parent component to refresh the feed list.
			if ( onImportComplete ) {
				onImportComplete();
			}

			// Close modal after a short delay to show the success message.
			setTimeout( () => {
				onClose();
			}, 2000 );
		} catch ( err ) {
			console.error( 'Error importing OPML:', err );
			setError(
				err.message || __( 'Failed to import OPML file. Please check the file and try again.', 'feeds' )
			);
		} finally {
			setIsLoading( false );
		}
	};

	return (
		<Modal
			title={ __( 'Import OPML', 'feeds' ) }
			onRequestClose={ onClose }
			className="feeds-import-opml-modal"
		>
			<div>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }

				{ result && (
					<Notice status="success" isDismissible={ false }>
						<p>{ result.message }</p>
						<p>
							{ __( 'Imported:', 'feeds' ) } <strong>{ result.imported }</strong>{ ' ' }
							{ __( 'Skipped:', 'feeds' ) } <strong>{ result.skipped }</strong>
						</p>
					</Notice>
				) }

				<p>
					{ __( 'Import your feeds from another RSS reader by uploading an OPML file.', 'feeds' ) }
				</p>

				<FormFileUpload
					accept=".opml,.xml"
					onChange={ handleFileChange }
					disabled={ isLoading }
				>
					{ selectedFile
						? selectedFile.name
						: __( 'Select OPML File', 'feeds' ) }
				</FormFileUpload>

				<div style={ { display: 'flex', gap: '10px', marginTop: '20px' } }>
					<Button
						variant="primary"
						onClick={ handleSubmit }
						isBusy={ isLoading }
						disabled={ isLoading || ! selectedFile || result }
					>
						{ __( 'Import', 'feeds' ) }
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

export default ImportOPMLModal;
