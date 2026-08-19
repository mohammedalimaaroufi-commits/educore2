import {
  Star, Heart, Check, Trophy, ThumbsUp, Flag,
  Clock, AlertTriangle, X, ThumbsDown, VolumeX, Frown,
  FileCheck, Camera, User, MessageCircle, Send, Archive, RotateCcw, Image as ImageIcon,
  Search, ChevronUp, ChevronDown,
} from 'lucide-react';

const ICON_MAP = {
  star: Star, heart: Heart, check: Check, trophy: Trophy, thumbsUp: ThumbsUp, flag: Flag,
  clock: Clock, alert: AlertTriangle, x: X, thumbsDown: ThumbsDown, volumeX: VolumeX, frown: Frown,
  fileCheck: FileCheck, camera: Camera, user: User, messageCircle: MessageCircle, send: Send,
  archive: Archive, restore: RotateCcw, image: ImageIcon,
  search: Search, chevronUp: ChevronUp, chevronDown: ChevronDown,
};

export default function Icon({ name, className = 'w-4 h-4', ...props }) {
  const Cmp = ICON_MAP[name] || Star;
  return <Cmp className={className} {...props} />;
}

export { ICON_MAP };
