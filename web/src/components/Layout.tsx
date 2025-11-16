// /web/src/components/Layout.tsx
import { Link, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar Navigation */}
      <nav className="w-56 flex-shrink-0 bg-white border-r border-gray-200">
        <div className="p-4">
          <h1 className="text-xl font-bold text-blue-700">Sentinel</h1>
        </div>
        <ul className="flex flex-col space-y-1 p-2">
          <li>
            <Link
              to="/dashboard"
              className="block px-3 py-2 rounded-md hover:bg-gray-100"
            >
              Dashboard
            </Link>
          </li>
          <li>
            <Link
              to="/alerts"
              className="block px-3 py-2 rounded-md hover:bg-gray-100"
            >
              Alerts
            </Link>
          </li>
          <li>
            <Link
              to="/evals"
              className="block px-3 py-2 rounded-md hover:bg-gray-100"
            >
              Evals
            </Link>
          </li>
        </ul>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet /> {/* This is where your pages will render */}
      </main>
    </div>
  );
}