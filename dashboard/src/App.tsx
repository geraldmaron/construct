import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
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
  return (
    <HashRouter>
      <div className="flex min-h-screen bg-white text-gray-900 antialiased">
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="flex h-14 items-center px-5 border-b border-gray-200 bg-black">
            <span className="text-lg font-bold tracking-tight text-white">Construct</span>
          </div>
          <nav className="mt-4 space-y-0.5 px-3">
            <NavLink to="/" end className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Resources</NavLink>
            <NavLink to="/workflow" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Workflow</NavLink>
            <NavLink to="/approvals" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Approvals</NavLink>
            <NavLink to="/snapshots" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Snapshots</NavLink>
            <div className="border-t border-gray-100 my-3" />
            <NavLink to="/agents" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Agents</NavLink>
            <NavLink to="/skills" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Skills</NavLink>
            <NavLink to="/commands" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Commands</NavLink>
            <NavLink to="/hooks" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Hooks</NavLink>
            <div className="border-t border-gray-100 my-3" />
            <NavLink to="/mcp" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>MCP</NavLink>
            <NavLink to="/plugins" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Plugins</NavLink>
            <NavLink to="/models" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Models</NavLink>
            <NavLink to="/artifacts" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Artifacts</NavLink>
            <NavLink to="/knowledge" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Knowledge</NavLink>
            <NavLink to="/infrastructure" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Infrastructure</NavLink>
            <NavLink to="/config" className={({ isActive }) => isActive ? activeLinkClass : inactiveLinkClass}>Config</NavLink>
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto p-8 bg-white">
          <Routes>
            <Route path="/" element={<Resources />} />
            <Route path="/workflow" element={<Workflow />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/snapshots" element={<Snapshots />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/commands" element={<Commands />} />
            <Route path="/hooks" element={<Hooks />} />
            <Route path="/mcp" element={<MCP />} />
            <Route path="/plugins" element={<Plugins />} />
            <Route path="/models" element={<Models />} />
            <Route path="/artifacts" element={<Artifacts />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/infrastructure" element={<Infrastructure />} />
            <Route path="/config" element={<Config />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

export default App;
