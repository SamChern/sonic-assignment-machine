import { Navigate } from "react-router-dom";

/**
 * The connected-only console is now a view inside the unified
 * "APIs & MCPs" page (/admin/integrations). Keep this route as a redirect.
 */
const AdminConnected = () => <Navigate to="/admin/integrations?view=connected" replace />;

export default AdminConnected;
