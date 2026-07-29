'use client';

import * as React from 'react';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { shareEvent } from '@/lib/share';
import { Button } from '@/components/ui/button';

type ShareEventButtonProps = {
  eventId: string;
  title: string;
  groupName?: string;
  className?: string;
};

export function ShareEventButton({ eventId, title, groupName, className }: ShareEventButtonProps) {
  const [sharing, setSharing] = React.useState(false);

  const handleShare = async () => {
    setSharing(true);
    try {
      const result = await shareEvent({ id: eventId, title, groupName });
      toast.success(
        result === 'shared'
          ? 'Link copied — share sheet opened'
          : 'Event link copied to clipboard',
      );
    } catch {
      toast.error('Could not share this event');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      loading={sharing}
      onClick={() => void handleShare()}
    >
      <Share2 className="h-4 w-4" aria-hidden />
      Share event
    </Button>
  );
}
