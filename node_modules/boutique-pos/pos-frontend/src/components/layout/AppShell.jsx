export default function AppShell({ collapsed, children, sidebar, topbar, mobileOpen, onCloseMobile }) {
  return (
    <div className={`app-shell no-print ${collapsed ? "is-collapsed" : ""}`}>
      {sidebar}
      <div className="content">
        {topbar}
        <main>{children}</main>
      </div>
      {mobileOpen ? <div className="mobile-scrim" role="presentation" onMouseDown={onCloseMobile} /> : null}
    </div>
  );
}
