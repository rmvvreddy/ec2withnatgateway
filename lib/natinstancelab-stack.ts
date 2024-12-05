import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class NatinstancelabStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly publicSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC
    this.vpc = new ec2.Vpc(this, 'MyVpc', {
      cidr: '11.0.0.0/16',
      maxAzs: 3,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Create Security Group for NAT and Public EC2 instances
    this.publicSg = new ec2.SecurityGroup(this, "public-sg", {
      vpc: this.vpc,
      allowAllOutbound: true,
    });

    this.publicSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), "allow SSH access");
    this.publicSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "allow HTTP access");
    this.publicSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "allow HTTPS access");

    const privatesg = new ec2.SecurityGroup(this, "private-sg", {
      vpc: this.vpc,
      allowAllOutbound: true,
    });

    privatesg.addIngressRule(this.publicSg, ec2.Port.tcp(22), "allow SSH access from public");
   

    // User data script for NAT instance
    const userDataScript = `
    #!/bin/bash
    yum install iptables-services -y
systemctl enable iptables
systemctl start iptables
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/custom-ip-forwarding.conf
sudo sysctl -p /etc/sysctl.d/custom-ip-forwarding.conf
sudo /sbin/iptables -t nat -A POSTROUTING -o $(route | awk '/^default/{print $NF}') -j MASQUERADE
sudo /sbin/iptables -F FORWARD
sudo service iptables save
    `;

    // Create NAT instance in Public Subnet
    const natInstance = new ec2.Instance(this, 'NatInstance', {
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: this.publicSg,
      keyName: 'mykeypair', // Replace with your EC2 key pair
      associatePublicIpAddress: true,
      userData: ec2.UserData.custom(userDataScript),
      sourceDestCheck: false,
    });

    // Disable Source/Destination Check for NAT instance
    // const cfnNatInstance = natInstance.node.defaultChild as ec2.CfnInstance;
    // cfnNatInstance.addOverride('Properties.SourceDestCheck', false);

    // Create Private EC2 instance
    const privateInstance = new ec2.Instance(this, 'PrivateInstance', {
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup:privatesg,
      keyName: 'mykeypair', // Replace with your EC2 key pair
    });

    // // Create a route for the private subnet through the NAT instance
    // this.vpc.privateSubnets.forEach((subnet, index) => {
    //   new ec2.CfnRoute(this, `PrivateRoute${index}`, {
    //     routeTableId: subnet.routeTable.routeTableId,
    //     destinationCidrBlock: '0.0.0.0/0',
    //     instanceId: natInstance.instanceId,
    //   });
    // });

    const privateSubnets = this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    }).subnets as ec2.Subnet[];
    
    // Loop through each private subnet and add a route to the NAT instance
    privateSubnets.forEach((subnet, index) => {
      subnet.addRoute(`NAT-route-${index}`, {
        routerId: natInstance.instanceId,
        routerType: ec2.RouterType.INSTANCE,
        destinationCidrBlock: "0.0.0.0/0",
      });
    });
    
  }
}

