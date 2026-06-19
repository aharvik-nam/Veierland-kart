/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { VeierlandApp } from "./components/VeierlandApp";
import { AdminPage } from "./components/AdminPage";

export default function App() {
  if (window.location.pathname === '/admin') return <AdminPage />;
  return <VeierlandApp />;
}
