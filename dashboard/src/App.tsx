import { HashRouter, Routes, Route, NavLink, useEffect, useState } from 'react-router-dom';
import './App.css';
import Resources from './pages/Resources';
import Workflow from './pages/Workflow';
import Approvals from './pages/Approvals';
import Snapshots from './pages/Snapshots';
import Agents from './pages/Agents';
import Skills from './pages/Skills';
import Commands from './pages/Commands';
import Hooks from './pages/Hooks';
import MCP from './pages/MCP';
import Plugins from './pages/Plugins';
import Models from './pages/Models';
import Artifacts from './pages/Artifacts';
import Knowledge from './pages/Knowledge';
import Infrastructure from './pages/Infrastructure';
import Config from './pages/Config';

const activeLinkClass = 'flex items-center px-3 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm';
const inactiveLinkClass = 'flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-800 hover:bg-gray-100 transition-colors';

function App() {
  const [mode, setMode] = useState('init'); // init, embed, live
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for embed config to determine mode
    // This is a simplified check - in reality we'd check for ~/.construct/embed.yaml
    // or make an API call to the backend
    const checkMode = async () => {
      try {
        // For now, we'll default to 'init' and rely on backend to tell us the mode
        // In a real implementation, this would check for embed configuration
        setMode('init'); // Default to init mode
        setLoading(false);
      } catch (error) {
        console.error('Failed to check mode:', error);
        setMode('init');
        setLoading(false);
      }
    };

    checkMode();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-white text-gray-900 antialiased">
        <div className="flex flex-col items-center justify-center h-full">
          <span className="animate-spin rounded-full border-4 border-indigo-600 border-t-transparent w-12 h-12"></span>
          <p className="mt-4 text-gray-600">Loading Construct...</p>
        </div>
      </div>
    );
  }

  // Determine which navigation items to show based on mode
  const getNavItems = () => {
    const baseItems = [
      { path: '/', label: 'Resources', element: <Resources /> },
      { path: '/workflow', label: 'Workflow', element: <Workflow /> },
      { path: '/approvals', label: 'Approvals', element: <Approvals /> },
      { path: '/snapshots', label: 'Snapshots', element: <Snapshots /> }
    ];

    // In embed mode, show more detailed views
    if (mode === 'embed' || mode === 'live') {
      return [
        ...baseItems,
        { path: '/agents', label: 'Agents', element: <Agents /> },
        { path: '/skills', label: 'Skills', element: <Skills /> },
        { path: '/commands', label: 'Commands', element: <Commands /> },
        { path: '/hooks', label: 'Hooks', element: <Hooks /> },
        { path: '/mcp', label: 'MCP', element: <MCP /> },
        { path: '/plugins', label: 'Plugins', element: <Plugins /> },
        { path: '/models', label: 'Models', element: <Models /> },
        { path: '/artifacts', label: 'Artifacts', element: <Artifacts /> },
        { path: '/knowledge', label: 'Knowledge', element: <Knowledge /> },
        { path: '/infrastructure', label: 'Infrastructure', element: <Infrastructure /> },
        { path: '/config', label: 'Config', element: <Config /> }
      ];
    }

    // In init mode, only show basic items
    return baseItems;
  };

  return (
    <HashRouter>
      <div className="flex min-h-screen bg-white text-gray-900 antialiased">
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="flex h-14 items-center px-5 border-b border-gray-200 bg-black">
            <span className="text-lg font-bold tracking-tight text-white">
              Construct {mode !== 'init' && `(${mode})`}
            </span>
          </div>
          <nav className="mt-4 space-y-0.5 px-3">
            {getNavItems().map(({ path, label }) => (
              <NavLink
                key={path}
                to={path}
                end={path === '/'}
                className={({ isActive }) => 
                  isActive ? activeLinkClass : inactiveLinkClass
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto p-8 bg-white">
          <Routes>
            {getNavItems().map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

export default App;
