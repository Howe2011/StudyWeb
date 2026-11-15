import {
  BookMarked,
  BookOpen,
  CalendarDays,
  CheckSquare,
  Gamepad2,
  Home,
  Layers,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingUp,
  UserCheck,
  X,
} from 'lucide-react';
import { WorkspaceTab } from '../types';

interface SidebarProps {
  activeTab: WorkspaceTab;
  revisionMode: string;
  plannerTab: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onSelectRevisionMode: (mode: string) => void;
  onSelectPlannerTab: (tab: string) => void;
  onSelectWorkspace: (tab: WorkspaceTab) => void;
}

export function Sidebar({
  activeTab,
  revisionMode,
  plannerTab,
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
  onSelectRevisionMode,
  onSelectPlannerTab,
  onSelectWorkspace,
}: SidebarProps) {
  const handleAction = (fn: () => void) => {
    fn();
    onCloseMobile();
  };

  const navItems = [
    {
      id: 'home',
      label: 'Home',
      icon: Home,
      active: activeTab === 'planner' && plannerTab === 'today',
      onClick: () => onSelectPlannerTab('today'),
    },
    {
      id: 'todo',
      label: 'To-do list',
      icon: CheckSquare,
      active: activeTab === 'planner' && plannerTab === 'todo',
      onClick: () => onSelectPlannerTab('todo'),
    },
    {
      id: 'calendar',
      label: 'Calendar',
      icon: CalendarDays,
      active: activeTab === 'planner' && plannerTab === 'calendar',
      onClick: () => onSelectPlannerTab('calendar'),
    },
    {
      id: 'subjects',
      label: 'Subjects',
      icon: BookMarked,
      active: activeTab === 'planner' && plannerTab === 'subjects',
      onClick: () => onSelectPlannerTab('subjects'),
    },
    {
      id: 'study',
      label: 'Study & Notes',
      icon: BookOpen,
      active: activeTab === 'revision' && revisionMode !== 'cards',
      onClick: () => onSelectRevisionMode('study'),
    },
    {
      id: 'cards',
      label: 'Flashcards',
      icon: Layers,
      active: activeTab === 'revision' && revisionMode === 'cards',
      onClick: () => onSelectRevisionMode('cards'),
    },
    {
      id: 'packs',
      label: 'Study Packs',
      icon: Package,
      active: activeTab === 'packs',
      onClick: () => onSelectWorkspace('packs'),
    },
    {
      id: 'quiz',
      label: 'Live Quiz',
      icon: Gamepad2,
      active: activeTab === 'quiz',
      onClick: () => onSelectWorkspace('quiz'),
    },
    {
      id: 'progress',
      label: 'Progress',
      icon: TrendingUp,
      active: activeTab === 'planner' && plannerTab === 'progress',
      onClick: () => onSelectPlannerTab('progress'),
    },
  ];

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
              onClick={() => handleAction(() => onSelectPlannerTab('today'))}
              className="font-display cursor-pointer text-lg font-extrabold tracking-tight text-[var(--ink)] whitespace-nowrap"
            >
              StudyDeck
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

        {/* Main 5 Navigation Items */}
        <nav
          aria-label="Workspace navigation"
          className={`flex min-h-0 flex-1 flex-col justify-between overflow-y-auto py-3 ${
            compact ? 'px-2' : 'px-3'
          }`}
        >
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  aria-current={item.active ? 'page' : undefined}
                  onClick={() => handleAction(item.onClick)}
                  className={`sd-nav-item ${compact ? 'justify-center px-0' : ''}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!compact && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>

          {/* Single Bottom Account & Data Button */}
          <div className="border-t border-[var(--line)] pt-3">
            <button
              type="button"
              title="Account & Data"
              aria-current={activeTab === 'vault' || activeTab === 'admin' ? 'page' : undefined}
              onClick={() => handleAction(() => onSelectWorkspace('vault'))}
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
      {/* Desktop persistent Quizlet-style left sidebar */}
      <aside
        aria-label="StudyDeck sidebar"
        className={`hidden shrink-0 border-r border-[var(--line)] lg:block ${
          collapsed ? 'w-[64px]' : 'w-[228px]'
        } transition-[width] duration-150`}
      >
        {navContent(false)}
      </aside>

      {/* Mobile slide-over drawer */}
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
