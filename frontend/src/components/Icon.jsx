import {
  Star, Heart, Check, Trophy, ThumbsUp, Flag,
  Clock, AlertTriangle, X, ThumbsDown, VolumeX, Frown,
  FileCheck, Camera, User, MessageCircle, Send, Archive, RotateCcw, Image as ImageIcon,
  Search, ChevronUp, ChevronDown, ArrowLeft, ArrowRight, Settings, LogOut, CreditCard, Bell, Filter, RefreshCw, BarChart3, FileText, LockKeyhole, Smartphone, Globe2, ShieldCheck, Pencil, Trash2, ExternalLink, GripVertical, Users, Plus,
} from 'lucide-react';

const ICON_MAP = {
  star: Star, heart: Heart, check: Check, trophy: Trophy, thumbsUp: ThumbsUp, flag: Flag,
  clock: Clock, alert: AlertTriangle, x: X, thumbsDown: ThumbsDown, volumeX: VolumeX, frown: Frown,
  fileCheck: FileCheck, camera: Camera, user: User, messageCircle: MessageCircle, send: Send,
  archive: Archive, restore: RotateCcw, image: ImageIcon,
  search: Search, chevronUp: ChevronUp, chevronDown: ChevronDown, arrowLeft: ArrowLeft, arrowRight: ArrowRight,
  settings: Settings, logout: LogOut, subscription: CreditCard, bell: Bell, filter: Filter, refresh: RefreshCw, analytics: BarChart3, reports: FileText,
  lock: LockKeyhole, android: Smartphone, web: Globe2, secure: ShieldCheck, edit: Pencil, trash: Trash2, externalLink: ExternalLink, grip: GripVertical, users: Users, plus: Plus,
};

export default function Icon({ name, className = 'w-4 h-4', ...props }) {
  const Cmp = ICON_MAP[name] || Star;
  return <Cmp className={className} {...props} />;
}

export { ICON_MAP };
