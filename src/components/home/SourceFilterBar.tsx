import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, X } from "lucide-react";

/**
 * Source multi-select used by both consumer result views. It lived twice, inline,
 * in the home page before the consolidation — one component now serves both.
 */
export const SourceFilterBar = ({
  sourceNames,
  selected,
  onToggle,
  onClear,
}: {
  sourceNames: string[];
  selected: string[];
  onToggle: (name: string) => void;
  onClear: () => void;
}) => {
  const [open, setOpen] = useState(false);
  if (sourceNames.length < 2) return null;

  const truncate = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, max)}...` : value;

  return (
    <Card className="border-border/50 bg-card/80 p-4 shadow-elegant backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="whitespace-nowrap text-sm font-semibold text-foreground">
          Filter by source:
        </label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between border-border bg-background sm:w-[300px]"
            >
              {selected.length === 0
                ? `All sources (${sourceNames.length})`
                : `${selected.length} selected`}
              <Check className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="z-50 w-[300px] border-border bg-background p-0">
            <Command className="bg-background">
              <CommandInput placeholder="Search sources..." className="h-9" />
              <CommandEmpty>No source found.</CommandEmpty>
              <CommandGroup className="max-h-64 overflow-auto">
                {sourceNames.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => onToggle(name)}
                    className="cursor-pointer"
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        selected.includes(name) ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <span className="truncate">{truncate(name, 35)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
        {selected.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              {selected.map((name) => (
                <Badge key={name} variant="secondary" className="gap-1">
                  {truncate(name, 20)}
                  <X
                    className="h-3 w-3 cursor-pointer hover:text-destructive"
                    onClick={() => onToggle(name)}
                  />
                </Badge>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={onClear} className="text-xs">
              Clear all
            </Button>
          </>
        )}
      </div>
    </Card>
  );
};

export default SourceFilterBar;
