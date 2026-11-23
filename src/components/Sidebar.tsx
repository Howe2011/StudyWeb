import {
  BookMarked,
  BookOpen,
  CalendarDays,
  CheckSquare,
  Gamepad2,
  Globe,
  Home,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Timer,
  TrendingUp,
  UserCheck,
  X,
} from 'lucide-react';
import { WorkspaceTab } from '../types';

interface SidebarProps {
  activeTab: WorkspaceTab;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onSelectTab: (tab: WorkspaceTab) => void;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: typeof Home;
}> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'subjects', label: 'Subjects', icon: BookMarked },
  { id: 'notes', label: 'Study Notes', icon: BookOpen },
  { id: 'flashcards', label: 'Flashcards', icon: Layers },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'planner', label: 'Planner', icon: CheckSquare },
  { id: 'timer', label: 'Timer', icon: Timer },
  { id: 'community', label: 'Community Share', icon: Globe },
  { id: 'quiz', label: 'Live Quiz', icon: Gamepad2 },
  { id: 'progress', label: 'Progress', icon: TrendingUp },
];

export function Sidebar({
  activeTab,
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
  onSelectTab,
}: SidebarProps) {
  const handleSelect = (tab: WorkspaceTab) => {
    onSelectTab(tab);
    onCloseMobile();
  };

  const navContent = (isMobileDrawer: boolean) => {
    const compact = collapsed && !isMobileDrawer;
    return (
      <div className="flex h-full flex-col bg-[var(--card)] text-[var(--ink)]">
        {/* Sidebar Brand Header */}
        <div
          className={`flex h-14 shrink-0 items-center border-b border-[var(--line)] ${
            compact ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          {!compact && (
            <button
              type="button"
              onClick={() => handleSelect('home')}
              className="font-display cursor-pointer text-lg font-extrabold tracking-tight text-[var(--ink)] whitespace-nowrap"
            >
              StudyWeb
            </button>
          )}
          {isMobileDrawer ? (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation"
              className="sd-btn h-8 w-8 rounded-lg p-0"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={compact ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
              className="sd-btn h-8 w-8 rounded-lg p-0"
            >
              {compact ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <nav
          aria-label="Workspace navigation"
          className={`flex min-h-0 flex-1 flex-col justify-between overflow-y-auto py-3 ${
            compact ? 'px-2' : 'px-3'
          }`}
        >
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => handleSelect(item.id)}
                  className={`sd-nav-item ${compact ? 'justify-center px-0' : ''}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!compact && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>

          {/* Account & Data */}
          <div className="border-t border-[var(--line)] pt-3">
            <button
              type="button"
              title="Account & Data"
              aria-current={activeTab === 'vault' || activeTab === 'admin' ? 'page' : undefined}
              onClick={() => handleSelect('vault')}
              className={`sd-nav-item ${compact ? 'justify-center px-0' : ''}`}
            >
              <UserCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!compact && <span className="truncate">Account &amp; Data</span>}
            </button>
          </div>
        </nav>
      </div>
    );
  };

  return (
    <>
      <aside
        aria-label="StudyWeb sidebar"
        className={`hidden shrink-0 border-r border-[var(--line)] lg:block ${
          collapsed ? 'w-[64px]' : 'w-[228px]'
        } transition-[width] duration-150`}
      >
        {navContent(false)}
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div
            className="fixed inset-0 bg-black/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full w-[260px] max-w-[85vw] border-r border-[var(--line)] shadow-xl">
            {navContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
