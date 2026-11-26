import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PublicFieldsNotice } from '@/components/privacy/PublicFieldsNotice';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  GOODS_CURRENCIES,
  GOODS_DESCRIPTION_MAX,
  GOODS_TITLE_MAX,
  safeHttpUrl,
  useCreateGoodsListing,
} from '@/hooks/useGoods';
import { useToast } from '@/hooks/useToast';
import { useUploadFile } from '@/hooks/useUploadFile';
import { GOODS_PUBLIC_FIELDS } from '@/lib/publicFields';
import { Loader2, Upload, X } from 'lucide-react';

const optionalUrl = z.string().trim().optional()
  .refine(value => !value || !!safeHttpUrl(value), 'Enter a link that starts with https://');

const goodsSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(GOODS_TITLE_MAX, `At most ${GOODS_TITLE_MAX} characters`),
  description: z.string().max(GOODS_DESCRIPTION_MAX, `At most ${GOODS_DESCRIPTION_MAX} characters`),
  price: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, 'Enter a price such as 12 or 12.50'),
  currency: z.enum(GOODS_CURRENCIES),
  location: z.string().max(100, 'At most 100 characters').optional(),
  link: optionalUrl,
});

type GoodsFormData = z.infer<typeof goodsSchema>;

interface CreateGoodsDialogProps {
  tribeId: string;
  children: React.ReactNode;
}

/** A short form that lists one item for sale in the tribe (a NIP-99 listing). */
export function CreateGoodsDialog({ tribeId, children }: CreateGoodsDialogProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { mutate: createListing, isPending } = useCreateGoodsListing();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState('');

  const form = useForm<GoodsFormData>({
    resolver: zodResolver(goodsSchema),
    defaultValues: { title: '', description: '', price: '', currency: 'USD', location: '', link: '' },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const [[, url]] = await uploadFile(file);
      setImage(url);
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({ title: 'Could not upload the picture', description: 'Please try again.', variant: 'destructive' });
    }
  };

  const onSubmit = (data: GoodsFormData) => {
    if (!user) {
      toast({ title: 'Login required', description: 'Please log in to list an item.', variant: 'destructive' });
      return;
    }
    createListing({
      tribe: tribeId,
      title: data.title,
      description: data.description,
      price: data.price,
      currency: data.currency,
      location: data.location || undefined,
      image: image || undefined,
      link: data.link || undefined,
    }, {
      onSuccess: () => {
        toast({ title: 'Item listed', description: 'Your item is now shown to the tribe.' });
        setOpen(false);
        form.reset();
        setImage('');
      },
      onError: (error) => {
        console.error('Goods listing error:', error);
        toast({ title: 'Could not list the item', description: 'Please try again.', variant: 'destructive' });
      },
    });
  };

  if (!user) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sell an item</DialogTitle>
          <DialogDescription>List one item for the members of this tribe.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Jar of wildflower honey" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-[1fr_auto] gap-4">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="12.50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-28" aria-label="Currency">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {GOODS_CURRENCIES.map(currency => (
                          <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Condition, size, how to pick it up…"
                      className="resize-none"
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{field.value.length}/{GOODS_DESCRIPTION_MAX} characters</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Area (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. East side, Saturday market" {...field} />
                  </FormControl>
                  <FormDescription>A general area. Share an exact address in a direct message.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label>Picture (optional)</Label>
              {image && (
                <div className="relative w-full overflow-hidden rounded-md border">
                  <img src={image} alt="Item preview" className="max-h-48 w-full object-cover" />
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute right-2 top-2 h-7 w-7"
                    onClick={() => setImage('')}
                    aria-label="Remove picture"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <Label htmlFor="goods-image-upload" className="cursor-pointer">
                <div className="flex items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted/50">
                  {isUploading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
                    : <><Upload className="h-4 w-4" /> {image ? 'Replace picture' : 'Upload a picture'}</>}
                </div>
              </Label>
              <input
                id="goods-image-upload"
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                disabled={isUploading}
              />
            </div>

            <FormField
              control={form.control}
              name="link"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product page (optional)</FormLabel>
                  <FormControl>
                    <Input type="url" placeholder="https://…" {...field} />
                  </FormControl>
                  <FormDescription>Where the item can be bought online, if anywhere.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <PublicFieldsNotice subject="this listing" fields={GOODS_PUBLIC_FIELDS} />

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || isUploading}>
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                List item
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
