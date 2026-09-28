export function formatDistance(meters?: number): string {
  if (meters === undefined) return 'Chưa xác định';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} phút`;
}

export function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    children: 'Trẻ em',
    exhibit: 'Trưng bày',
    garden: 'Vườn cảnh',
    indoor: 'Trong nhà',
    interactive: 'Tương tác',
    landmark: 'Điểm hẹn',
    ride: 'Trò chơi',
    show: 'Biểu diễn',
    thrill_ride: 'Cảm giác mạnh',
  };
  return labels[category] ?? category;
}
