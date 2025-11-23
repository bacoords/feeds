/**
 * Main App Component
 * Handles routing between FeedReader and FeedManager views
 */
import { TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import FeedReader from './views/FeedReader';
import FeedManager from './views/FeedManager';

const TABS = {
	READER: 'reader',
	MANAGER: 'manager',
};

const App = () => {
	const tabs = [
		{
			name: TABS.READER,
			title: __( 'Reader', 'feeds' ),
			className: 'feeds-tab',
		},
		{
			name: TABS.MANAGER,
			title: __( 'Manage Feeds', 'feeds' ),
			className: 'feeds-tab',
		},
	];

	const renderTabContent = ( tabName ) => {
		switch ( tabName ) {
			case TABS.READER:
				return <FeedReader />;
			case TABS.MANAGER:
				return <FeedManager />;
			default:
				return null;
		}
	};

	return (
		<div className="feeds-app-container">
			<div className="feeds-app-header">
				<h1>{ __( 'Feeds', 'feeds' ) }</h1>
			</div>

			<TabPanel tabs={ tabs } initialTabName={ TABS.READER }>
				{ ( tab ) => (
					<div className="feeds-app-content">
						{ renderTabContent( tab.name ) }
					</div>
				) }
			</TabPanel>
		</div>
	);
};

export default App;
