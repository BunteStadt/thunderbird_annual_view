create table public.subscriptions (
    user_id uuid primary key references auth.users (id) on delete cascade,
    stripe_customer_id text unique,
    stripe_subscription_id text unique,
    stripe_price_id text,
    status text not null default 'none' check (
        status in (
            'none',
            'incomplete',
            'incomplete_expired',
            'trialing',
            'active',
            'past_due',
            'canceled',
            'unpaid',
            'paused'
        )
    ),
    current_period_end timestamptz,
    cancel_at_period_end boolean not null default false,
    stripe_event_created_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions (status);

alter table public.subscriptions enable row level security;

create policy "Users can read their own subscription"
on public.subscriptions
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert, update, delete on public.subscriptions to service_role;

create table public.stripe_webhook_events (
    event_id text primary key,
    event_type text not null,
    event_created_at timestamptz not null,
    processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

revoke all on public.stripe_webhook_events from anon, authenticated;
grant select, insert, update, delete on public.stripe_webhook_events to service_role;

comment on table public.stripe_webhook_events is
    'Service-role-only idempotency ledger for verified Stripe webhook events.';