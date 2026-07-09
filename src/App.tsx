/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { VeierlandApp } from "./components/VeierlandApp";
import { AdminPage } from "./components/AdminPage";
import { PrivacyPage } from "./components/PrivacyPage";

export default function App() {
  if (window.location.pathname === '/admin') return <AdminPage />;
  if (window.location.pathname === '/personvern' || window.location.pathname === '/privacy') return <PrivacyPage />;
  return <VeierlandApp />;
}
