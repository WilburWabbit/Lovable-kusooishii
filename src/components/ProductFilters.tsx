import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { X, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export interface FilterState {
  themes: string[];
  priceRange: [number, number];
  conditions: string[];
  yearRange: [number, number];
  retiredOnly: boolean;
  showSoldOut: boolean;
}

interface ProductFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  availableThemes: string[];
  priceRange: [number, number];
  yearRange: [number, number];
  className?: string;
}

const CONDITIONS = [
  { value: '1', label: 'Grade 1 — Mint' },
  { value: '2', label: 'Grade 2 — Excellent' },
  { value: '3', label: 'Grade 3 — Good' },
  { value: '4', label: 'Grade 4 — Acceptable' },
  { value: '5', label: 'Grade 5 — Red Card' },
];

export default function ProductFilters({
  filters, onFiltersChange, availableThemes, priceRange, yearRange, className = ""
}: ProductFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openSections, setOpenSections] = useState({ theme: true, condition: true, price: true, year: false, retired: false });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const updateFilters = (key: keyof FilterState, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const toggleArrayFilter = (key: 'themes' | 'conditions', value: string) => {
    const arr = filters[key];
    updateFilters(key, arr.includes(value) ? arr.filter(i => i !== value) : [...arr, value]);
  };

  const clearAllFilters = () => {
    onFiltersChange({ themes: [], priceRange, conditions: [], yearRange, retiredOnly: false, showSoldOut: false });
  };

  const safe = {
    themes: filters.themes ?? [],
    conditions: filters.conditions ?? [],
    priceRange: filters.priceRange ?? priceRange,
    yearRange: filters.yearRange ?? yearRange,
    retiredOnly: filters.retiredOnly ?? false,
    showSoldOut: filters.showSoldOut ?? false,
  };

  const hasActive =
    safe.themes.length > 0 || safe.conditions.length > 0 || safe.retiredOnly || safe.showSoldOut ||
    safe.priceRange[0] !== priceRange[0] || safe.priceRange[1] !== priceRange[1] ||
    safe.yearRange[0] !== yearRange[0] || safe.yearRange[1] !== yearRange[1];

  const activeCount =
    safe.themes.length + safe.conditions.length +
    (safe.retiredOnly ? 1 : 0) + (safe.showSoldOut ? 1 : 0) +
    (safe.priceRange[0] !== priceRange[0] || safe.priceRange[1] !== priceRange[1] ? 1 : 0) +
    (safe.yearRange[0] !== yearRange[0] || safe.yearRange[1] !== yearRange[1] ? 1 : 0);

  function FilterContent() {
    return (
      <div className="space-y-6">
        {/* Theme */}
        <Collapsible open={openSections.theme} onOpenChange={() => toggleSection('theme')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <Label className="font-display text-xs font-semibold uppercase tracking-widest cursor-pointer">Theme</Label>
            {openSections.theme ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-3">
            {availableThemes.map(theme => (
              <div key={theme} className="flex items-center space-x-2">
                <Checkbox id={`theme-${theme}`} checked={safe.themes.includes(theme)} onCheckedChange={() => toggleArrayFilter('themes', theme)} />
                <Label htmlFor={`theme-${theme}`} className="cursor-pointer flex-1 font-body text-sm">{theme}</Label>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Condition */}
        <Collapsible open={openSections.condition} onOpenChange={() => toggleSection('condition')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <Label className="font-display text-xs font-semibold uppercase tracking-widest cursor-pointer">Condition</Label>
            {openSections.condition ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-3">
            {CONDITIONS.map(cond => (
              <div key={cond.value} className="flex items-center space-x-2">
                <Checkbox id={`cond-${cond.value}`} checked={safe.conditions.includes(cond.value)} onCheckedChange={() => toggleArrayFilter('conditions', cond.value)} />
                <Label htmlFor={`cond-${cond.value}`} className="cursor-pointer flex-1 font-body text-sm">{cond.label}</Label>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Price */}
        <Collapsible open={openSections.price} onOpenChange={() => toggleSection('price')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <Label className="font-display text-xs font-semibold uppercase tracking-widest cursor-pointer">Price Range</Label>
            {openSections.price ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 mt-3">
            <div className="px-2">
              <Slider value={safe.priceRange} onValueChange={(v) => updateFilters('priceRange', v as [number, number])} max={priceRange[1]} min={priceRange[0]} step={5} />
              <div className="flex justify-between font-body text-sm text-muted-foreground mt-2">
                <span>£{safe.priceRange[0]}</span><span>£{safe.priceRange[1]}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Year */}
        <Collapsible open={openSections.year} onOpenChange={() => toggleSection('year')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <Label className="font-display text-xs font-semibold uppercase tracking-widest cursor-pointer">Year</Label>
            {openSections.year ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 mt-3">
            <div className="px-2">
              <Slider value={safe.yearRange} onValueChange={(v) => updateFilters('yearRange', v as [number, number])} max={yearRange[1]} min={yearRange[0]} step={1} />
              <div className="flex justify-between font-body text-sm text-muted-foreground mt-2">
                <span>{safe.yearRange[0]}</span><span>{safe.yearRange[1]}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Status */}
        <div className="space-y-3">
          <Label className="font-display text-xs font-semibold uppercase tracking-widest">Status</Label>
          <div className="flex items-center justify-between">
            <Label htmlFor="retired-toggle" className="cursor-pointer font-body text-sm">Retired sets only</Label>
            <Switch id="retired-toggle" checked={safe.retiredOnly} onCheckedChange={c => updateFilters('retiredOnly', c)} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="sold-out-toggle" className="cursor-pointer font-body text-sm">Include sold out</Label>
            <Switch id="sold-out-toggle" checked={safe.showSoldOut} onCheckedChange={c => updateFilters('showSoldOut', c)} />
          </div>
        </div>

        {/* Active Filters */}
        {hasActive && (
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <Label className="font-display text-xs font-semibold">Active Filters</Label>
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="font-body text-xs">Clear All</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {safe.themes.map(t => (
                <Badge key={t} variant="secondary" className="flex items-center gap-1 font-body text-xs">
                  {t} <X className="h-3 w-3 cursor-pointer" onClick={() => toggleArrayFilter('themes', t)} />
                </Badge>
              ))}
              {safe.conditions.map(c => (
                <Badge key={c} variant="secondary" className="flex items-center gap-1 font-body text-xs">
                  Grade {c} <X className="h-3 w-3 cursor-pointer" onClick={() => toggleArrayFilter('conditions', c)} />
                </Badge>
              ))}
              {safe.retiredOnly && (
                <Badge variant="secondary" className="flex items-center gap-1 font-body text-xs">
                  Retired <X className="h-3 w-3 cursor-pointer" onClick={() => updateFilters('retiredOnly', false)} />
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-card rounded-sm border border-border sticky top-20 ${className}`}>
      {/* Mobile */}
      <div className="lg:hidden">
        <Button variant="outline" onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between p-4 font-display">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <span>Filters</span>
            {activeCount > 0 && <Badge variant="secondary" className="h-5">{activeCount}</Badge>}
          </div>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        {isOpen && <div className="p-4 border-t border-border"><FilterContent /></div>}
      </div>

      {/* Desktop */}
      <div className="hidden lg:block p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            <h3 className="font-display text-sm font-semibold">Filters</h3>
            {activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}
          </div>
          {hasActive && <Button variant="ghost" size="sm" onClick={clearAllFilters} className="font-body text-xs">Clear All</Button>}
        </div>
        <FilterContent />
      </div>
    </div>
  );
}
