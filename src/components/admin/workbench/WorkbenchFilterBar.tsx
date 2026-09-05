import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Filter, User, Radio, Layers, Check, X } from "lucide-react";
import { type TagOption } from "@/lib/identifierFilters";
import { IdentifierFilterBar } from "@/components/IdentifierFilterBar";
import type { IdentifierFilterState } from "@/lib/identifierFilters";
import type { EntityMode, UserProfile } from "./types";
import { providerMeta } from "./types";

interface CohortLike {
  key: string;
  label: string;
  members: unknown[];
}

interface WorkbenchFilterBarProps {
  entityMode: EntityMode;
  setEntityMode: (mode: EntityMode) => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  activeFilterCount: number;
  users: UserProfile[];
  filteredUserIds: string[];
  toggleUserFilter: (userId: string) => void;
  cohorts: CohortLike[];
  selectedCohortKeys: string[];
  toggleCohortFilter: (key: string) => void;
  providerKeys: string[];
  sourceCountByProvider: (provider: string) => number;
  filteredProviders: string[];
  toggleProviderFilter: (provider: string) => void;
  clearFilters: () => void;
  identifierFilter: IdentifierFilterState;
  setIdentifierFilter: (state: IdentifierFilterState) => void;
  identifierTagOptions: TagOption[];
  signalPointsCount: number;
  allSignalPointsCount: number;
}

/** Global entity-mode switcher + filter picker shared across every tab. */
export function WorkbenchFilterBar({
  entityMode,
  setEntityMode,
  filterOpen,
  setFilterOpen,
  activeFilterCount,
  users,
  filteredUserIds,
  toggleUserFilter,
  cohorts,
  selectedCohortKeys,
  toggleCohortFilter,
  providerKeys,
  sourceCountByProvider,
  filteredProviders,
  toggleProviderFilter,
  clearFilters,
  identifierFilter,
  setIdentifierFilter,
  identifierTagOptions,
  signalPointsCount,
  allSignalPointsCount,
}: WorkbenchFilterBarProps) {
  return (
    <Card className="p-4 mb-6 bg-card/80">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <span className="text-sm font-medium text-muted-foreground">Filter by source</span>
          <div className="flex w-full sm:w-auto sm:inline-flex overflow-x-auto no-scrollbar rounded-md border border-border p-0.5 bg-muted">

            <Button
              size="sm"
              variant={entityMode === "user" ? "default" : "ghost"}
              className="h-9 shrink-0 gap-1.5 whitespace-nowrap"
              onClick={() => setEntityMode("user")}
            >
              <User className="h-3.5 w-3.5" />
              User
            </Button>
            <Button
              size="sm"
              variant={entityMode === "provider" ? "default" : "ghost"}
              className="h-9 shrink-0 gap-1.5 whitespace-nowrap"
              onClick={() => setEntityMode("provider")}
            >
              <Radio className="h-3.5 w-3.5" />
              Signal Provider
            </Button>
            <Button
              size="sm"
              variant={entityMode === "signal" ? "default" : "ghost"}
              className="h-9 shrink-0 gap-1.5 whitespace-nowrap"
              onClick={() => setEntityMode("signal")}
            >
              <Layers className="h-3.5 w-3.5" />
              Identifier Signals
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                Filter by
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0 bg-popover" align="start">
              <Command>
                <CommandInput
                  placeholder={
                    entityMode === "user"
                      ? "Search users..."
                      : entityMode === "provider"
                        ? "Search signal providers..."
                        : "Search cohorts..."
                  }
                />
                <CommandList>
                  <CommandEmpty>
                    {entityMode === "user"
                      ? "No users found."
                      : entityMode === "provider"
                        ? "No signal providers found."
                        : "No cohorts yet."}
                  </CommandEmpty>
                  <CommandGroup>
                    {entityMode === "user"
                      ? users.map(u => (
                          <CommandItem
                            key={u.user_id}
                            onSelect={() => toggleUserFilter(u.user_id)}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={u.avatar_url || undefined} />
                              <AvatarFallback><User className="h-3 w-3" /></AvatarFallback>
                            </Avatar>
                            <span className="flex-1">{u.username || 'Anonymous'}</span>
                            {filteredUserIds.includes(u.user_id) && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </CommandItem>
                        ))
                      : entityMode === "signal"
                      ? cohorts.map(c => (
                          <CommandItem
                            key={c.key}
                            onSelect={() => toggleCohortFilter(c.key)}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <Layers className="h-4 w-4 text-primary" />
                            <span className="flex-1">{c.label}</span>
                            <span className="text-xs text-muted-foreground mr-1">
                              {c.members.length}
                            </span>
                            {selectedCohortKeys.includes(c.key) && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </CommandItem>
                        ))
                      : providerKeys.map(p => (
                          <CommandItem
                            key={p}
                            onSelect={() => toggleProviderFilter(p)}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <Radio className="h-4 w-4 text-primary" />
                            <span className="flex-1">{providerMeta(p).label}</span>
                            <span className="text-xs text-muted-foreground mr-1">
                              {sourceCountByProvider(p)}
                            </span>
                            {filteredProviders.includes(p) && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </CommandItem>
                        ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {/* Filter badges */}
          {entityMode === "user"
            ? filteredUserIds.map(uid => {
                const u = users.find(user => user.user_id === uid);
                if (!u) return null;
                return (
                  <Badge key={uid} variant="secondary" className="gap-1 pr-1">
                    {u.username || 'Anonymous'}
                    <button
                      onClick={() => toggleUserFilter(uid)}
                      className="ml-1 hover:bg-muted rounded-full p-0.5"
                      aria-label={`Remove ${u.username || 'Anonymous'} filter`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })
            : entityMode === "signal"
            ? selectedCohortKeys.map(key => {
                const c = cohorts.find(co => co.key === key);
                if (!c) return null;
                return (
                  <Badge key={key} variant="secondary" className="gap-1 pr-1">
                    {c.label}
                    <button
                      onClick={() => toggleCohortFilter(key)}
                      className="ml-1 hover:bg-muted rounded-full p-0.5"
                      aria-label={`Remove ${c.label} filter`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })
            : filteredProviders.map(p => (
                <Badge key={p} variant="secondary" className="gap-1 pr-1">
                  {providerMeta(p).label}
                  <button
                    onClick={() => toggleProviderFilter(p)}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                    aria-label={`Remove ${providerMeta(p).label} filter`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear All
            </Button>
          )}
        </div>

        {entityMode === "signal" && (
          <div className="pt-1 border-t border-border/60">
            <IdentifierFilterBar
              value={identifierFilter}
              onChange={setIdentifierFilter}
              tags={identifierTagOptions}
              resultCount={signalPointsCount}
              totalCount={allSignalPointsCount}
              placeholder="Search pseudonym, tag code or facet…"
              className="pt-3"
            />
          </div>
        )}
      </div>
    </Card>
  );
}
