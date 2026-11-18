import type { ComponentType, SVGProps } from 'react';

import IcActivity from '@/assets/icons/activity.svg?react';
import IcAlert from '@/assets/icons/alert.svg?react';
import IcArrowDown from '@/assets/icons/arrow-down.svg?react';
import IcArrowUp from '@/assets/icons/arrow-up.svg?react';
import IcAttachments from '@/assets/icons/attachments.svg?react';
import IcBarChart from '@/assets/icons/bar-chart.svg?react';
import IcBell from '@/assets/icons/bell.svg?react';
import IcBook from '@/assets/icons/book.svg?react';
import IcBookmark from '@/assets/icons/bookmark.svg?react';
import IcBuilding from '@/assets/icons/building.svg?react';
import IcCheck from '@/assets/icons/check.svg?react';
import IcChevronRight from '@/assets/icons/chevron-right.svg?react';
import IcClock from '@/assets/icons/clock.svg?react';
import IcDatabase from '@/assets/icons/database.svg?react';
import IcDownload from '@/assets/icons/download.svg?react';
import IcEye from '@/assets/icons/eye.svg?react';
import IcFile from '@/assets/icons/file.svg?react';
import IcFilter from '@/assets/icons/filter.svg?react';
import IcGauge from '@/assets/icons/gauge.svg?react';
import IcGlobe from '@/assets/icons/globe.svg?react';
import IcKey from '@/assets/icons/key.svg?react';
import IcLock from '@/assets/icons/lock.svg?react';
import IcMail from '@/assets/icons/mail.svg?react';
import IcPlug from '@/assets/icons/plug.svg?react';
import IcPlus from '@/assets/icons/plus.svg?react';
import IcSearch from '@/assets/icons/search.svg?react';
import IcSettings from '@/assets/icons/settings.svg?react';
import IcShield from '@/assets/icons/shield-outline.svg?react';
import IcSparkles from '@/assets/icons/sparkles.svg?react';
import IcOrgTree from '@/assets/icons/org-tree.svg?react';
import IcUsers from '@/assets/icons/users.svg?react';
import IcX from '@/assets/icons/x.svg?react';

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<string, SvgIcon> = {
  activity: IcActivity,
  alert: IcAlert,
  arrowDown: IcArrowDown,
  arrowUp: IcArrowUp,
  barChart: IcBarChart,
  bell: IcBell,
  book: IcBook,
  bookmark: IcBookmark,
  building: IcBuilding,
  check: IcCheck,
  chevR: IcChevronRight,
  clock: IcClock,
  clip: IcAttachments,
  db: IcDatabase,
  download: IcDownload,
  eye: IcEye,
  file: IcFile,
  filter: IcFilter,
  gauge: IcGauge,
  globe: IcGlobe,
  key: IcKey,
  lock: IcLock,
  mail: IcMail,
  paperclip: IcAttachments,
  plug: IcPlug,
  plus: IcPlus,
  search: IcSearch,
  settings: IcSettings,
  shield: IcShield,
  sitemap: IcOrgTree,
  sparkle: IcSparkles,
  users: IcUsers,
  x: IcX,
};

interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  const Svg = ICONS[name];
  if (!Svg) return null;
  return <Svg width={size} height={size} className={className} aria-hidden="true" focusable="false" />;
}
