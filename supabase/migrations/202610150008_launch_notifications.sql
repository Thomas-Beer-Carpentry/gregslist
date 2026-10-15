-- Reuse recipient-private updates. No new messaging platform or consent path.
create function private.partner_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare notice_kind text; notice text;
begin
 if tg_op='INSERT' and new.status='pending' then
  notice_kind:='partner_requested'; notice:='A member sent you a partner-link request. Review it in partner settings.';
 elsif tg_op='UPDATE' and old.status is distinct from new.status then
  case new.status
   when 'confirmed' then notice_kind:='partner_accepted'; notice:='Your partner-link request was accepted. Partner booking options are now available.';
   when 'declined' then notice_kind:='partner_declined'; notice:='Your partner-link request was declined.';
   when 'revoked' then notice_kind:='partner_unlinked'; notice:='A partner link or request has ended. Existing reservations remain passenger-owned; check your arrangements.';
   else return new;
  end case;
 else return new;
 end if;
 perform private.transport_notice(array[new.user_a,new.user_b],null,notice_kind,notice);
 return new;
end $$;
revoke all on function private.partner_notification() from public,anon,authenticated;
create trigger partner_updates after insert or update of status on public.partner_relationships for each row execute function private.partner_notification();
