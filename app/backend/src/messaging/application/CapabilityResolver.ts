import AppError from "../../errors/AppError";
import {
  capabilitiesFor,
  MessagingCapability,
  MessagingProviderName,
  providerForChannel,
  ProviderCapabilities
} from "../contracts/CapabilityMatrix";

class CapabilityResolver {
  resolve(channelType?: string | null): {
    provider: MessagingProviderName;
    capabilities: ProviderCapabilities;
  } {
    const provider = providerForChannel(channelType);
    return { provider, capabilities: capabilitiesFor(provider) };
  }

  require(channelType: string | null | undefined, capability: MessagingCapability): void {
    const { capabilities } = this.resolve(channelType);
    if (!capabilities[capability]) throw new AppError("CAPABILITY_NOT_SUPPORTED", 422);
  }
}

export default CapabilityResolver;
