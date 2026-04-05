export type LoadedPhoto = { img: HTMLImageElement; uploadedAt: number };
export type ActivePhoto = { img: HTMLImageElement; startTime: number; slot: Slot };
export type Slot = { x: number; y: number; w: number; h: number };

export interface PhotoSystemConfig {
    photoDuration?: number;
    photoAlpha?: number;
    maxActive?: number;
    marginRatio?: number;
    supabaseUrl?: string;
    supabaseKey?: string;
    localPhotos?: string[];
    photoBaseUrl?: string;
}

export class PhotoSystem {
    private photoPool: LoadedPhoto[] = [];
    private activePhotos: ActivePhoto[] = [];
    private slots: Slot[] = [];
    private config: Required<PhotoSystemConfig>;
    private supabase: any = null;

    constructor(config: PhotoSystemConfig = {}, supabaseClient?: any) {
        this.config = {
            photoDuration: config.photoDuration ?? 5,
            photoAlpha: config.photoAlpha ?? 0.8,
            maxActive: config.maxActive ?? 4,
            marginRatio: config.marginRatio ?? 0.2,
            supabaseUrl: config.supabaseUrl ?? "https://fixpfxxlnuhwzvbgcykm.supabase.co",
            supabaseKey: config.supabaseKey ?? "sb_publishable_9SUF0gKkr4337Ai9i4kCrg_pSaW2sSI",
            localPhotos: config.localPhotos ?? [
                "foto1.jpg", "foto2.jpg", "foto3.jpg", "foto4.jpg", "foto5.jpg",
                "foto6.jpg", "foto7.jpg", "foto8.jpg", "foto9.jpg", "foto10.jpg", "foto11.jpg"
            ],
            photoBaseUrl: config.photoBaseUrl ?? "fotos/"
        };
        if (supabaseClient) this.supabase = supabaseClient;
    }

    public setSupabaseClient(client: any) {
        this.supabase = client;
    }

    public generateSlots(width: number, height: number) {
        this.slots = [];
        const { marginRatio } = this.config;
        const marginX = width * marginRatio;
        const marginY = height * marginRatio;
        const cell = marginY;

        for (let x = marginX; x < width - marginX; x += cell) this.slots.push({ x, y: 0, w: cell, h: marginY });
        for (let x = marginX; x < width - marginX; x += cell) this.slots.push({ x, y: height - marginY, w: cell, h: marginY });
        for (let y = marginY; y < height - marginY; y += cell) this.slots.push({ x: 0, y, w: marginX, h: cell });
        for (let y = marginY; y < height - marginY; y += cell) this.slots.push({ x: width - marginX, y, w: marginX, h: cell });
    }

    public async loadPhotos(): Promise<void> {
        const now = performance.now() / 1000;
        const localEntries = this.config.localPhotos.map(src => ({
            url: this.config.photoBaseUrl + src,
            uploadedAt: now - 999999
        }));

        let supabaseEntries: { url: string, uploadedAt: number }[] = [];
        
        if (!this.supabase && (window as any).supabase) {
            this.supabase = (window as any).supabase.createClient(this.config.supabaseUrl, this.config.supabaseKey);
        }

        if (this.supabase) {
            try {
                const { data, error } = await this.supabase.storage.from("photos").list("", { limit: 100 });
                if (!error && data) {
                    supabaseEntries = data.map((f: any) => ({
                        url: `${this.config.supabaseUrl}/storage/v1/object/public/photos/${f.name}`,
                        uploadedAt: f.created_at ? new Date(f.created_at).getTime() / 1000 : now - 1000
                    }));
                }
            } catch (err) {
                console.warn("Supabase load failed", err);
            }
        }

        const all = [...localEntries, ...supabaseEntries];
        const promises = all.map(entry =>
            new Promise<LoadedPhoto | null>((resolve) => {
                const img = new Image();
                img.onload = () => resolve({ img, uploadedAt: entry.uploadedAt });
                img.onerror = () => resolve(null);
                img.src = entry.url;
            })
        );

        const results = await Promise.all(promises);
        this.photoPool = results.filter((p): p is LoadedPhoto => p !== null);
        console.log("[PhotoSystem] Loaded pool size:", this.photoPool.length);
    }

    public spawnPhoto(now: number) {
        if (this.photoPool.length === 0 || this.activePhotos.length >= this.config.maxActive) return;
        const used = this.activePhotos.map(p => p.slot);
        const free = this.slots.filter(s => used.indexOf(s) === -1);
        if (free.length === 0) return;

        const weights = this.photoPool.map(p => {
            const age = now - p.uploadedAt;
            if (age < 300) return 5;
            if (age < 1800) return 2;
            return 1;
        });

        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        let selectedIndex = 0;
        for (let i = 0; i < this.photoPool.length; i++) {
            r -= weights[i];
            if (r <= 0) { selectedIndex = i; break; }
        }

        const photo = this.photoPool[selectedIndex];
        const slot = free[Math.floor(Math.random() * free.length)];
        this.activePhotos.push({ img: photo.img, startTime: now, slot });
    }

    public update(dt: number) {
        const now = performance.now() / 1000;
        this.activePhotos = this.activePhotos.filter(p => now - p.startTime < this.config.photoDuration);
        if (this.activePhotos.length < 2 || Math.random() < 0.03) this.spawnPhoto(now);
    }

    public draw(ctx: CanvasRenderingContext2D) {
        for (const p of this.activePhotos) {
            const { img, slot } = p;
            ctx.save();
            ctx.globalAlpha = this.config.photoAlpha;
            const scale = Math.min(slot.w / img.width, slot.h / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = slot.x + (slot.w - w) / 2;
            const y = slot.y + (slot.h - h) / 2;
            ctx.drawImage(img, x, y, w, h);
            ctx.restore();
        }
    }
}