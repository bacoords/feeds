/**
 * Main App Component
 * Handles routing between FeedReader and FeedManager views
 */
import { useState } from '@wordpress/element';
import { Button, Panel, PanelBody, PanelRow } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import FeedReader from './views/FeedReader';
import FeedManager from './views/FeedManager';

const App = () => {
	const [ currentView, setCurrentView ] = useState( 'reader' );

	return (
		<div className="feeds-app-container">
			<div className="feeds-app-header">
				<h1>{ __( 'Feeds', 'feeds' ) }</h1>
				<div className="feeds-app-nav">
					<Button
						variant={ currentView === 'reader' ? 'primary' : 'secondary' }
						onClick={ () => setCurrentView( 'reader' ) }
					>
						{ __( 'Reader', 'feeds' ) }
					</Button>
					<Button
						variant={ currentView === 'manager' ? 'primary' : 'secondary' }
						onClick={ () => setCurrentView( 'manager' ) }
					>
						{ __( 'Manage Feeds', 'feeds' ) }
					</Button>
				</div>
			</div>

			<div className="feeds-app-content">
				{ currentView === 'reader' && <FeedReader /> }
				{ currentView === 'manager' && <FeedManager /> }
			</div>
		</div>
	);
};

export default App;
