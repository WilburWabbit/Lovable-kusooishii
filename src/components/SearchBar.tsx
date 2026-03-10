import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/lib/store';
import { useNavigate } from 'react-router-dom';

interface SearchBarProps {
  onClose?: () => void;
  autoFocus?: boolean;
}

const SearchBar = ({ onClose, autoFocus = false }: SearchBarProps) => {
  const [query, setQuery] = useState('');
  const setSearchQuery = useStore(state => state.setSearchQuery);
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setSearchQuery(query);
      navigate(`/browse?q=${encodeURIComponent(query)}`);
      onClose?.();
    }
  };

  return (
    <form onSubmit={handleSearch} className="flex items-center gap-2 w-full">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search sets, themes, set numbers..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 pr-4 font-body"
          autoFocus={autoFocus}
        />
      </div>
      <Button type="submit" size="sm" className="font-display">Search</Button>
      {onClose && (
        <Button type="button" variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </form>
  );
};

export default SearchBar;
