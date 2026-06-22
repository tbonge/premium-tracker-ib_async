export const calendarDte = (expiry?: string, now: Date = new Date()): number | undefined => {
    if (!expiry) return undefined;
    const match = expiry.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return undefined;
    const expiryDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((expiryDay - today) / 86400000);
};
